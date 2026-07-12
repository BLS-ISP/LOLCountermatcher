use std::collections::HashMap;
use std::fs;
use std::sync::Arc;
use std::path::PathBuf;
use std::net::UdpSocket;
use axum::{
    extract::{
        ws::{Message as WsMessage, WebSocket as AxumWebSocket, WebSocketUpgrade},
        State, Query, Path as AxumPath,
    },
    response::IntoResponse,
    http::{header, StatusCode},
    Json,
};
use futures_util::StreamExt;
use futures_util::SinkExt;
use serde::{Deserialize, Serialize};

use crate::core::state::AppStateContext;
use crate::clients::lcu_ws::LCU_MUTEX;
use crate::providers::ddragon::DD_MANAGER;
use crate::providers::cache::{
    get_match_history_file, get_exe_dir, get_notes_file, get_custom_builds_file,
    get_cached_stats, get_cached_opgg_stats
};
use crate::core::settings::{SETTINGS, Settings, load_settings, save_settings};
use crate::core::draft::get_champion_tips;
use crate::Asset;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchRecord {
    pub champion: String,
    pub role: String,
    pub cs_min: f64,
    pub gold_spent: i32,
    pub duration_sec: i32,
    pub win: bool,
    pub timestamp: String,
}

#[derive(Deserialize)]
pub struct AddMatchRequest {
    pub champion: String,
    pub role: String,
    pub cs_min: f64,
    pub gold_spent: i32,
    pub duration_sec: i32,
    pub win: bool,
}

fn get_last_match_win_for_puuid(history: &serde_json::Value, my_puuid: &str) -> Option<bool> {
    let games = history.get("games")
        .and_then(|g| g.get("games").and_then(|v| v.as_array()).or_else(|| g.as_array()))?;
    let last_game = games.first()?;

    // Find participantId for my_puuid
    let identities = last_game.get("participantIdentities").and_then(|v| v.as_array())?;
    let mut target_participant_id = None;
    for identity in identities {
        if let Some(player) = identity.get("player") {
            if let Some(puuid) = player.get("puuid").and_then(|v| v.as_str()) {
                if puuid == my_puuid {
                    target_participant_id = identity.get("participantId").and_then(|v| v.as_i64());
                    break;
                }
            }
        }
    }

    let pid = target_participant_id?;

    // Find stats for that participantId
    let participants = last_game.get("participants").and_then(|v| v.as_array())?;
    for participant in participants {
        if let Some(p_id) = participant.get("participantId").and_then(|v| v.as_i64()) {
            if p_id == pid {
                if let Some(stats) = participant.get("stats") {
                    return stats.get("win").and_then(|v| v.as_bool());
                }
            }
        }
    }

    None
}

fn map_lcu_role_to_std(lane: &str, role: &str) -> String {
    let clean_lane = lane.to_uppercase();
    let clean_role = role.to_uppercase();

    if clean_lane == "JUNGLE" {
        "jungle".to_string()
    } else if clean_lane == "TOP" {
        "top".to_string()
    } else if clean_lane == "MIDDLE" || clean_lane == "MID" {
        "mid".to_string()
    } else if clean_lane == "BOTTOM" || clean_lane == "BOT" {
        if clean_role.contains("SUPPORT") {
            "support".to_string()
        } else {
            "adc".to_string()
        }
    } else {
        "mid".to_string() // default fallback
    }
}

fn map_lcu_matches(history: &serde_json::Value, my_puuid: &str) -> Option<Vec<MatchRecord>> {
    let games = history.get("games")
        .and_then(|g| g.get("games").and_then(|v| v.as_array()).or_else(|| g.as_array()))?;

    let mut records = vec![];

    for game in games {
        let game_duration = game.get("gameDuration").and_then(|v| v.as_i64()).unwrap_or(0);
        if game_duration == 0 {
            continue;
        }

        let date_str = game.get("gameCreationDate")
            .and_then(|v| v.as_str())
            .map(|s| {
                if s.len() >= 16 {
                    s[0..16].replace("T", " ")
                } else {
                    s.to_string()
                }
            })
            .unwrap_or_else(|| "Unknown Date".to_string());

        // Find participantId for my_puuid
        let identities = game.get("participantIdentities").and_then(|v| v.as_array())?;
        let mut target_participant_id = None;
        for identity in identities {
            if let Some(player) = identity.get("player") {
                if let Some(puuid) = player.get("puuid").and_then(|v| v.as_str()) {
                    if puuid == my_puuid {
                        target_participant_id = identity.get("participantId").and_then(|v| v.as_i64());
                        break;
                    }
                }
            }
        }

        let pid = match target_participant_id {
            Some(id) => id,
            None => continue,
        };

        // Find participant stats
        let participants = game.get("participants").and_then(|v| v.as_array())?;
        for participant in participants {
            let p_id = participant.get("participantId").and_then(|v| v.as_i64()).unwrap_or(0);
            if p_id == pid {
                let champ_id = participant.get("championId").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
                let champ = DD_MANAGER.get_champion_by_id(champ_id);

                let stats = participant.get("stats")?;
                let win = stats.get("win").and_then(|v| v.as_bool()).unwrap_or(false);
                let total_minions = stats.get("totalMinionsKilled").and_then(|v| v.as_i64()).unwrap_or(0);
                let neutral_minions = stats.get("neutralMinionsKilled").and_then(|v| v.as_i64()).unwrap_or(0);
                let total_cs = total_minions + neutral_minions;
                let duration_min = (game_duration as f64) / 60.0;
                let cs_min = if duration_min > 0.0 { (total_cs as f64) / duration_min } else { 0.0 };
                let gold_spent = stats.get("goldEarned").and_then(|v| v.as_i64()).unwrap_or(0) as i32;

                let timeline = participant.get("timeline");
                let lane = timeline.and_then(|t| t.get("lane")).and_then(|v| v.as_str()).unwrap_or("");
                let role = timeline.and_then(|t| t.get("role")).and_then(|v| v.as_str()).unwrap_or("");
                let mapped_role = map_lcu_role_to_std(lane, role);

                records.push(MatchRecord {
                    champion: champ.name,
                    role: mapped_role,
                    cs_min,
                    gold_spent,
                    duration_sec: game_duration as i32,
                    win,
                    timestamp: date_str.clone(),
                });
                break;
            }
        }
    }

    Some(records)
}

pub async fn index_handler() -> impl IntoResponse {
    let path = PathBuf::from("static/index.html");
    if path.exists() {
        if let Ok(content) = fs::read(&path) {
            return (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "text/html")],
                content,
            ).into_response();
        }
    }

    match Asset::get("index.html") {
        Some(content) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "text/html")],
            content.data.into_owned(),
        ).into_response(),
        None => (
            StatusCode::NOT_FOUND,
            "<h1>LoL Countermatcher Frontend is missing!</h1><p>Please create index.html in the static directory.</p>",
        ).into_response(),
    }
}

fn get_content_type(path: &str) -> &'static str {
    if path.ends_with(".html") { "text/html" }
    else if path.ends_with(".css") { "text/css" }
    else if path.ends_with(".js") { "application/javascript" }
    else if path.ends_with(".png") { "image/png" }
    else if path.ends_with(".ico") { "image/x-icon" }
    else if path.ends_with(".json") { "application/json" }
    else { "application/octet-stream" }
}

pub async fn static_handler(AxumPath(path): AxumPath<String>) -> impl IntoResponse {
    let clean_path = path.trim_start_matches('/');
    let content_type = get_content_type(clean_path);
    
    // Prevent browser caching for JS/CSS so live edits are always served fresh
    let cache_control = if clean_path.ends_with(".js") || clean_path.ends_with(".css") {
        "no-cache, no-store, must-revalidate"
    } else {
        "public, max-age=3600"
    };

    let local_path = PathBuf::from("static").join(clean_path);
    if local_path.exists() {
        if let Ok(content) = fs::read(&local_path) {
            return (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, content_type),
                    (header::CACHE_CONTROL, cache_control),
                ],
                content,
            ).into_response();
        }
    }

    match Asset::get(clean_path) {
        Some(content) => (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, content_type),
                (header::CACHE_CONTROL, cache_control),
            ],
            content.data.into_owned(),
        ).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

pub async fn get_champions() -> impl IntoResponse {
    let mut list = vec![];
    for (id, champ) in &DD_MANAGER.champions {
        list.push(serde_json::json!({
            "id": id,
            "name": champ.name,
            "key": champ.key,
            "image": champ.image,
            "tags": champ.tags
        }));
    }
    list.sort_by(|a, b| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")));
    Json(list)
}

pub async fn debug_live_data() -> impl IntoResponse {
    let debug_path = std::path::PathBuf::from("live_client_debug.json");
    if debug_path.exists() {
        if let Ok(content) = fs::read_to_string(&debug_path) {
            return (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "application/json")],
                content,
            ).into_response();
        }
    }
    (
        StatusCode::NOT_FOUND,
        [(header::CONTENT_TYPE, "application/json")],
        r#"{"error": "No debug snapshot yet. Enter a game first."}"#.to_string(),
    ).into_response()
}

pub async fn get_connection_url() -> impl IntoResponse {
    let socket = UdpSocket::bind("0.0.0.0:0");
    let mut local_ip = "127.0.0.1".to_string();
    if let Ok(socket) = socket {
        if socket.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = socket.local_addr() {
                local_ip = addr.ip().to_string();
            }
        }
    }
    Json(serde_json::json!({
        "local_ip": local_ip,
        "port": 8000,
        "url": format!("http://{}:8000", local_ip)
    }))
}

#[derive(Deserialize)]
pub struct NotesQuery {
    pub champion: String,
}

pub async fn get_notes(Query(q): Query<NotesQuery>) -> impl IntoResponse {
    let path = get_notes_file();
    let mut notes_map = HashMap::new();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            notes_map = serde_json::from_str::<HashMap<String, String>>(&content).unwrap_or_default();
        }
    }
    let note = notes_map.get(&q.champion.to_lowercase()).cloned().unwrap_or_default();
    Json(serde_json::json!({ "note": note }))
}

#[derive(Deserialize)]
pub struct UpdateNotesRequest {
    pub champion: String,
    pub note: String,
}

pub async fn update_notes(Json(req): Json<UpdateNotesRequest>) -> impl IntoResponse {
    let path = get_notes_file();
    let mut notes_map = HashMap::new();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            notes_map = serde_json::from_str::<HashMap<String, String>>(&content).unwrap_or_default();
        }
    }
    notes_map.insert(req.champion.to_lowercase(), req.note);
    if let Ok(content) = serde_json::to_string_pretty(&notes_map) {
        fs::write(&path, content).ok();
    }
    Json(serde_json::json!({ "success": true }))
}

pub async fn get_settings() -> impl IntoResponse {
    load_settings();
    let s = SETTINGS.lock().unwrap().clone();
    Json(s)
}

pub async fn update_settings(Json(req): Json<Settings>) -> impl IntoResponse {
    save_settings(&req);
    Json(serde_json::json!({ "success": true }))
}

#[derive(Deserialize)]
pub struct CustomBuildQuery {
    pub champion: String,
    pub role: String,
}

#[derive(Deserialize)]
pub struct SaveCustomBuildRequest {
    pub champion: String,
    pub role: String,
    pub build: serde_json::Value,
}

pub async fn get_custom_build(Query(q): Query<CustomBuildQuery>) -> impl IntoResponse {
    let path = get_custom_builds_file();
    let mut builds = HashMap::new();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            builds = serde_json::from_str::<HashMap<String, serde_json::Value>>(&content).unwrap_or_default();
        }
    }
    let key = format!("{}_{}", q.champion.to_lowercase(), q.role.to_lowercase());
    let build = builds.get(&key).cloned().unwrap_or(serde_json::Value::Null);
    Json(build)
}

pub async fn save_custom_build(Json(req): Json<SaveCustomBuildRequest>) -> impl IntoResponse {
    let path = get_custom_builds_file();
    let mut builds = HashMap::new();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            builds = serde_json::from_str::<HashMap<String, serde_json::Value>>(&content).unwrap_or_default();
        }
    }
    let key = format!("{}_{}", req.champion.to_lowercase(), req.role.to_lowercase());
    builds.insert(key, req.build);
    if let Ok(content) = serde_json::to_string_pretty(&builds) {
        fs::write(&path, content).ok();
    }
    Json(serde_json::json!({ "success": true }))
}

pub async fn get_match_history(
    State(ctx): State<Arc<AppStateContext>>,
) -> impl IntoResponse {
    let mut lcu = LCU_MUTEX.lock().await;
    if lcu.is_connected().await {
        let my_puuid_opt = {
            let state_guard = ctx.state.read().await;
            state_guard.summoner.as_ref().map(|s| s.puuid.clone())
        };
        if let Some(puuid) = my_puuid_opt {
            if let Some(lcu_history) = lcu.get_match_history().await {
                if let Some(mapped) = map_lcu_matches(&lcu_history, &puuid) {
                    println!("[Backend] Successfully pulled {} match history records from LCU client.", mapped.len());
                    return Json(mapped);
                }
            }
        }
    }

    let path = get_match_history_file();
    let mut history = vec![];
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            history = serde_json::from_str::<Vec<MatchRecord>>(&content).unwrap_or_default();
        }
    }
    history.reverse(); // Newest matches first
    Json(history)
}

pub async fn add_match_record(
    State(ctx): State<Arc<AppStateContext>>,
    Json(req): Json<AddMatchRequest>,
) -> impl IntoResponse {
    let path = get_match_history_file();
    let mut history = vec![];
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            history = serde_json::from_str::<Vec<MatchRecord>>(&content).unwrap_or_default();
        }
    }
    
    let mut win = req.win;
    let mut lcu = LCU_MUTEX.lock().await;
    if lcu.is_connected().await {
        if let Some(lcu_history) = lcu.get_match_history().await {
            let my_puuid_opt = {
                let state_guard = ctx.state.read().await;
                state_guard.summoner.as_ref().map(|s| s.puuid.clone())
            };
            if let Some(puuid) = my_puuid_opt {
                if let Some(actual_win) = get_last_match_win_for_puuid(&lcu_history, &puuid) {
                    println!("[Backend] Overriding game win/loss with LCU match history result: {}", actual_win);
                    win = actual_win;
                }
            }
        }
    }
    
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
    
    let record = MatchRecord {
        champion: req.champion,
        role: req.role,
        cs_min: req.cs_min,
        gold_spent: req.gold_spent,
        duration_sec: req.duration_sec,
        win,
        timestamp: now,
    };
    
    history.push(record);
    
    if let Ok(content) = serde_json::to_string_pretty(&history) {
        fs::write(&path, content).ok();
    }
    
    Json(serde_json::json!({"success": true}))
}

#[derive(Deserialize)]
pub struct OptimizeBuildRequest {
    pub target_stat: String,
    pub include_boots: bool,
}

#[derive(Serialize)]
pub struct OptimizedItem {
    pub id: String,
    pub name: String,
    pub image: String,
    pub gold_total: i32,
    pub stat_value: f64,
}

#[derive(Serialize)]
pub struct OptimizeBuildResponse {
    pub items: Vec<OptimizedItem>,
    pub total_gold: i32,
    pub total_stat: f64,
}

pub async fn optimize_build(
    Json(req): Json<OptimizeBuildRequest>,
) -> impl IntoResponse {
    let stat_key = match req.target_stat.as_str() {
        "ap" => "FlatMagicDamageMod",
        "ad" => "FlatPhysicalDamageMod",
        "health" => "FlatHPPoolMod",
        "armor" => "FlatArmorMod",
        "mr" => "FlatSpellBlockMod",
        "as" => "PercentAttackSpeedMod",
        _ => "FlatMagicDamageMod",
    };

    // Filter items
    let mut filtered_items = vec![];
    for item in DD_MANAGER.items.values() {
        if item.purchasable
            && item.maps.get("11") == Some(&true)
            && item.gold_total > 0
        {
            let stat_val = item.stats.get(stat_key).cloned().unwrap_or(0.0);
            if stat_val > 0.0 {
                filtered_items.push((item, stat_val));
            }
        }
    }

    // Sort descending by stat value
    filtered_items.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let mut selected_items = vec![];
    let mut selected_ids = std::collections::HashSet::new();

    // Check if we need boots
    if req.include_boots {
        // Find the best boot that has the target stat
        let mut best_boot = None;
        for (item, val) in &filtered_items {
            if item.tags.iter().any(|t| t == "Boots") {
                best_boot = Some((*item, *val));
                break;
            }
        }

        // If no boot has the target stat, take a default boot
        let boot_to_add = match best_boot {
            Some(b) => Some(b),
            None => {
                let mut fallback_boot = None;
                let target_boot_name = match req.target_stat.as_str() {
                    "ap" => "Sorcerer's Shoes",
                    "as" => "Berserker's Greaves",
                    "armor" => "Plated Steelcaps",
                    "mr" => "Mercury's Treads",
                    _ => "Ionian Boots of Lucidity",
                };
                for item in DD_MANAGER.items.values() {
                    if item.tags.iter().any(|t| t == "Boots") && item.name == target_boot_name {
                        fallback_boot = Some((item, 0.0));
                        break;
                    }
                }
                if fallback_boot.is_none() {
                    for item in DD_MANAGER.items.values() {
                        if item.tags.iter().any(|t| t == "Boots") && item.gold_total > 0 && item.purchasable {
                            fallback_boot = Some((item, 0.0));
                            break;
                        }
                    }
                }
                fallback_boot
            }
        };

        if let Some((boot_item, boot_val)) = boot_to_add {
            selected_items.push(OptimizedItem {
                id: boot_item.id.clone(),
                name: boot_item.name.clone(),
                image: boot_item.image.clone(),
                gold_total: boot_item.gold_total,
                stat_value: boot_val,
            });
            selected_ids.insert(boot_item.id.clone());
        }
    }

    // Now select regular items (up to 5 if boots included, else up to 6)
    let max_regular_slots = if req.include_boots { 5 } else { 6 };
    let mut regular_count = 0;

    for (item, val) in &filtered_items {
        if regular_count >= max_regular_slots {
            break;
        }

        if item.tags.iter().any(|t| t == "Boots") {
            continue;
        }

        if selected_ids.contains(&item.id) {
            continue;
        }

        if item.tags.iter().any(|t| t == "Jungle" || t == "GoldInflow") {
            continue;
        }

        selected_items.push(OptimizedItem {
            id: item.id.clone(),
            name: item.name.clone(),
            image: item.image.clone(),
            gold_total: item.gold_total,
            stat_value: *val,
        });
        selected_ids.insert(item.id.clone());
        regular_count += 1;
    }

    let total_gold: i32 = selected_items.iter().map(|i| i.gold_total).sum();
    let total_stat: f64 = selected_items.iter().map(|i| i.stat_value).sum();

    Json(OptimizeBuildResponse {
        items: selected_items,
        total_gold,
        total_stat,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GithubRelease {
    pub tag_name: String,
    pub assets: Vec<GithubAsset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GithubAsset {
    pub name: String,
    pub browser_download_url: String,
}

pub async fn check_update() -> impl IntoResponse {
    let client = reqwest::Client::builder()
        .user_agent("lol_countermatcher_app")
        .timeout(std::time::Duration::from_secs(5))
        .build();
    
    if let Ok(c) = client {
        if let Ok(res) = c.get("https://api.github.com/repos/BLS-ISP/LOLCountermatcher/releases/latest").send().await {
            if let Ok(release) = res.json::<GithubRelease>().await {
                let latest_tag = release.tag_name.replace("v", "");
                let current_ver = env!("CARGO_PKG_VERSION");
                
                if latest_tag != current_ver {
                    let asset = release.assets.iter().find(|a| a.name.ends_with(".exe"));
                    if let Some(a) = asset {
                        return Json(serde_json::json!({
                            "update_available": true,
                            "latest_version": release.tag_name,
                            "current_version": format!("v{}", current_ver),
                            "download_url": a.browser_download_url
                        }));
                    }
                }
            }
        }
    }
    
    Json(serde_json::json!({
        "update_available": false,
        "latest_version": format!("v{}", env!("CARGO_PKG_VERSION")),
        "current_version": format!("v{}", env!("CARGO_PKG_VERSION")),
        "download_url": ""
    }))
}

#[derive(Deserialize)]
pub struct TriggerUpdateRequest {
    pub download_url: String,
}

pub async fn trigger_update(Json(req): Json<TriggerUpdateRequest>) -> impl IntoResponse {
    let client = reqwest::Client::builder()
        .user_agent("lol_countermatcher_app")
        .build();
        
    if let Ok(c) = client {
        if let Ok(res) = c.get(&req.download_url).send().await {
            if let Ok(bytes) = res.bytes().await {
                let exe_dir = get_exe_dir();
                let new_exe_path = exe_dir.join("lol_countermatcher_new.exe");
                if fs::write(&new_exe_path, bytes).is_ok() {
                    if let Ok(curr_exe_path) = std::env::current_exe() {
                        if let Some(curr_exe_name) = curr_exe_path.file_name().and_then(|n| n.to_str()) {
                            let script = format!(
                                "timeout /t 2 /nobreak && del \"{}\" && rename lol_countermatcher_new.exe \"{}\" && start \"\" \"{}\"",
                                curr_exe_name, curr_exe_name, curr_exe_name
                            );
                            
                            std::process::Command::new("cmd")
                                .args(&["/c", &script])
                                .current_dir(&exe_dir)
                                .spawn()
                                .ok();
                                
                            std::process::exit(0);
                        }
                    }
                }
            }
        }
    }
    
    Json(serde_json::json!({ "success": false, "error": "Download failed" }))
}

#[derive(Deserialize)]
pub struct SearchQuery {
    pub champion: String,
    pub role: Option<String>,
}

pub async fn search_champion(Query(q): Query<SearchQuery>) -> impl IntoResponse {
    let role = q.role.unwrap_or_else(|| "mid".to_string());
    let champ_opt = DD_MANAGER.get_champion_by_name(&q.champion);
    let champ = match champ_opt {
        Some(c) => c,
        None => return (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": format!("Champion '{}' not found.", q.champion) }))).into_response(),
    };

    let name = champ.name.clone();
    let role_ugg = role.clone();
    let ugg_task = tokio::task::spawn_blocking(move || get_cached_stats(&name, &role_ugg));
    let name = champ.name.clone();
    let opgg_task = tokio::task::spawn_blocking(move || get_cached_opgg_stats(&name, &role));

    let stats_ugg = ugg_task.await.unwrap_or(None);
    let stats_opgg = opgg_task.await.unwrap_or(None);

    if stats_ugg.is_none() && stats_opgg.is_none() {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Failed to retrieve stats from both U.GG and OP.GG." }))).into_response();
    }

    let tips = get_champion_tips(&champ.name);
    Json(serde_json::json!({
        "ugg": stats_ugg,
        "opgg": stats_opgg,
        "tips": tips
    })).into_response()
}

#[derive(Deserialize)]
pub struct ImportRunesRequest {
    pub primary_style_id: i32,
    pub sub_style_id: i32,
    pub perk_ids: Vec<i32>,
    pub shard_ids: Vec<i32>,
    pub page_name: String,
}

pub async fn import_runes(Json(req): Json<ImportRunesRequest>) -> impl IntoResponse {
    let mut lcu = LCU_MUTEX.lock().await;
    let res = lcu.import_runes(
        req.primary_style_id,
        req.sub_style_id,
        req.perk_ids,
        req.shard_ids,
        &req.page_name,
    ).await;
    Json(res)
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(ctx): State<Arc<AppStateContext>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, ctx))
}

pub async fn handle_socket(mut socket: AxumWebSocket, ctx: Arc<AppStateContext>) {
    let initial_state = {
        let current = ctx.state.read().await;
        serde_json::to_string(&*current).unwrap_or_default()
    };
    if socket.send(WsMessage::Text(initial_state)).await.is_err() {
        return;
    }

    let mut rx = ctx.tx.subscribe();
    let (mut sender, mut receiver) = socket.split();

    let mut send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if sender.send(WsMessage::Text(msg)).await.is_err() {
                break;
            }
        }
    });

    let mut receiver_task = tokio::spawn(async move {
        while let Some(Ok(_)) = receiver.next().await {
            // Keep connection alive, discard client inputs
        }
    });

    tokio::select! {
        _ = (&mut send_task) => receiver_task.abort(),
        _ = (&mut receiver_task) => send_task.abort(),
    }
}
