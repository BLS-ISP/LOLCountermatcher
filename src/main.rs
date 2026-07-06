use std::collections::{HashMap, HashSet};
use std::fs;
use std::net::UdpSocket;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use axum::{
    extract::{
        ws::{Message as WsMessage, WebSocket as AxumWebSocket},
        Path as AxumPath, Query, State, WebSocketUpgrade,
    },
    http::{header, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex as TokioMutex;
use tower_http::cors::CorsLayer;
use futures_util::{StreamExt, SinkExt};

mod ddragon;
mod lcu;
mod state;
mod ugg;
mod opgg;

use ddragon::DD_MANAGER;
use lcu::LcuManager;
use state::{AppState, AppStateContext, ChampSelectState, SummonerInfo};

#[derive(RustEmbed)]
#[folder = "static/"]
struct Asset;

lazy_static::lazy_static! {
    static ref STATS_CACHE: std::sync::Mutex<HashMap<(String, String), serde_json::Value>> = std::sync::Mutex::new(HashMap::new());
    static ref OPGG_CACHE: std::sync::Mutex<HashMap<(String, String), serde_json::Value>> = std::sync::Mutex::new(HashMap::new());
    static ref SETTINGS: std::sync::Mutex<Settings> = std::sync::Mutex::new(Settings::default());
    static ref LCU_MUTEX: Arc<TokioMutex<LcuManager>> = Arc::new(TokioMutex::new(LcuManager::new()));
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub voice_coach_enabled: bool,
    pub voice_name: String,
    pub voice_speed: f64,
    pub voice_pitch: f64,
    pub hotkey_ctrl: bool,
    pub hotkey_alt: bool,
    pub hotkey_shift: bool,
    pub hotkey_keys: String,
    pub default_source: String,
    pub default_matchups: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            voice_coach_enabled: true,
            voice_name: String::new(),
            voice_speed: 1.0,
            voice_pitch: 1.0,
            hotkey_ctrl: true,
            hotkey_alt: true,
            hotkey_shift: false,
            hotkey_keys: "1-5".to_string(),
            default_source: "ugg".to_string(),
            default_matchups: "worst".to_string(),
        }
    }
}

// Helpers for cache paths
fn get_exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn get_cache_dir() -> PathBuf {
    let dir = get_exe_dir().join("cache");
    fs::create_dir_all(&dir).ok();
    dir
}

fn get_settings_file() -> PathBuf {
    get_exe_dir().join("settings.json")
}

fn get_notes_file() -> PathBuf {
    get_exe_dir().join("matchup_notes.json")
}

fn get_tips_file() -> PathBuf {
    get_exe_dir().join("tips.json")
}

fn get_champion_tips(champ_name: &str) -> Vec<String> {
    if let Ok(content) = fs::read_to_string(get_tips_file()) {
        if let Ok(tips_map) = serde_json::from_str::<HashMap<String, Vec<String>>>(&content) {
            for (key, tips) in tips_map {
                if key.eq_ignore_ascii_case(champ_name) {
                    return tips;
                }
            }
        }
    }

    // Fallback based on DDragon tags
    if let Some(champ) = DD_MANAGER.get_champion_by_name(champ_name) {
        if champ.tags.iter().any(|t| t == "Mage") {
            return vec![
                "Build Magic Resist (e.g. Negatron Cloak) early to survive their spell rotations.".to_string(),
                "Abuse their high skill cooldowns and mana dependencies early in the lane.".to_string(),
                "Dodge their main poke spells before looking for all-in trades.".to_string(),
            ];
        } else if champ.tags.iter().any(|t| t == "Assassin") {
            return vec![
                "Respect their level 6 power spike. Play defensively when their ultimate is available.".to_string(),
                "Keep river bushes warded to track their flanking and roaming movements.".to_string(),
                "Build early Armor/Magic Resist or items like Zhonya's/Sterak's to survive their burst.".to_string(),
            ];
        } else if champ.tags.iter().any(|t| t == "Tank") {
            return vec![
                "Build Percent Health damage items (e.g., Liandry's Torment, Lord Dominik's Regards) to shred them.".to_string(),
                "Avoid wasting major high-damage spell rotations on them in teamfights; target squishier enemies.".to_string(),
                "Be wary of their crowd control (CC) chains during teamfights or river skirmishes.".to_string(),
            ];
        } else if champ.tags.iter().any(|t| t == "Marksman") {
            return vec![
                "Coordinate with your Jungler to lock them down and burst them down before they can scale.".to_string(),
                "Prioritize buying armor upgrades (like Plated Steelcaps) to reduce their basic attack damage.".to_string(),
                "Avoid long, extended trades where they can stack their damage and run you down.".to_string(),
            ];
        }
    }

    vec![
        "Focus on securing minion farm and staying safe under tower when matches are tough.".to_string(),
        "Keep river pathways warded to detect roaming and gank setups from enemy junglers.".to_string(),
        "Coordinate objective timing and teamfights with your allies to convert gold leads.".to_string(),
    ]
}

// Check if stats are in local JSON cache
fn is_locally_cached(champion_name: &str, role: &str, prefix: &str) -> bool {
    let safe_name = champion_name.to_lowercase().replace(" ", "").replace("'", "");
    let path = get_cache_dir().join(format!("{}_{}_{}.json", prefix, safe_name, role.to_lowercase()));
    if path.exists() {
        if let Ok(meta) = fs::metadata(&path) {
            if let Ok(modified) = meta.modified() {
                if let Ok(elapsed) = modified.elapsed() {
                    return elapsed.as_secs() < 86400; // 24 hours
                }
            }
        }
    }
    false
}

// Fetch or load cached U.GG stats
fn get_cached_stats(champion_name: &str, role: &str) -> Option<serde_json::Value> {
    let key = (champion_name.to_lowercase(), role.to_lowercase());
    if let Some(cached) = STATS_CACHE.lock().unwrap().get(&key) {
        return Some(cached.clone());
    }

    let safe_name = champion_name.to_lowercase().replace(" ", "").replace("'", "");
    let filename = get_cache_dir().join(format!("ugg_{}_{}.json", safe_name, role.to_lowercase()));

    if filename.exists() {
        if let Ok(meta) = fs::metadata(&filename) {
            if let Ok(modified) = meta.modified() {
                if let Ok(elapsed) = modified.elapsed() {
                    if elapsed.as_secs() < 86400 {
                        if let Ok(content) = fs::read_to_string(&filename) {
                            if let Ok(stats) = serde_json::from_str::<serde_json::Value>(&content) {
                                if stats.get("build").is_some() {
                                    STATS_CACHE.lock().unwrap().insert(key, stats.clone());
                                    return Some(stats);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let stats = ugg::fetch_champion_stats(champion_name, role);
    if let Ok(val) = serde_json::to_value(&stats) {
        if val.get("build").and_then(|v| v.get("runes")).is_some() {
            STATS_CACHE.lock().unwrap().insert(key, val.clone());
            if let Ok(content) = serde_json::to_string_pretty(&val) {
                fs::write(&filename, content).ok();
            }
            return Some(val);
        }
    }

    None
}

// Fetch or load cached OP.GG stats
fn get_cached_opgg_stats(champion_name: &str, role: &str) -> Option<serde_json::Value> {
    let key = (champion_name.to_lowercase(), role.to_lowercase());
    if let Some(cached) = OPGG_CACHE.lock().unwrap().get(&key) {
        return Some(cached.clone());
    }

    let safe_name = champion_name.to_lowercase().replace(" ", "").replace("'", "");
    let filename = get_cache_dir().join(format!("opgg_{}_{}.json", safe_name, role.to_lowercase()));

    if filename.exists() {
        if let Ok(meta) = fs::metadata(&filename) {
            if let Ok(modified) = meta.modified() {
                if let Ok(elapsed) = modified.elapsed() {
                    if elapsed.as_secs() < 86400 {
                        if let Ok(content) = fs::read_to_string(&filename) {
                            if let Ok(stats) = serde_json::from_str::<serde_json::Value>(&content) {
                                if stats.get("build").is_some() {
                                    OPGG_CACHE.lock().unwrap().insert(key, stats.clone());
                                    return Some(stats);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if let Some(stats) = opgg::fetch_opgg_champion_stats(champion_name, role) {
        if let Ok(val) = serde_json::to_value(&stats) {
            if val.get("build").and_then(|v| v.get("runes")).is_some() {
                OPGG_CACHE.lock().unwrap().insert(key, val.clone());
                if let Ok(content) = serde_json::to_string_pretty(&val) {
                    fs::write(&filename, content).ok();
                }
                return Some(val);
            }
        }
    }

    None
}

// Load cached U.GG stats only from disk (no network requests)
fn get_cached_stats_only_disk(champion_name: &str, role: &str) -> Option<serde_json::Value> {
    let key = (champion_name.to_lowercase(), role.to_lowercase());
    if let Some(cached) = STATS_CACHE.lock().unwrap().get(&key) {
        return Some(cached.clone());
    }

    let safe_name = champion_name.to_lowercase().replace(" ", "").replace("'", "");
    let filename = get_cache_dir().join(format!("ugg_{}_{}.json", safe_name, role.to_lowercase()));

    if filename.exists() {
        if let Ok(content) = fs::read_to_string(&filename) {
            if let Ok(stats) = serde_json::from_str::<serde_json::Value>(&content) {
                if stats.get("build").is_some() {
                    STATS_CACHE.lock().unwrap().insert(key, stats.clone());
                    return Some(stats);
                }
            }
        }
    }
    None
}

// Load cached OP.GG stats only from disk (no network requests)
fn get_cached_opgg_stats_only_disk(champion_name: &str, role: &str) -> Option<serde_json::Value> {
    let key = (champion_name.to_lowercase(), role.to_lowercase());
    if let Some(cached) = OPGG_CACHE.lock().unwrap().get(&key) {
        return Some(cached.clone());
    }

    let safe_name = champion_name.to_lowercase().replace(" ", "").replace("'", "");
    let filename = get_cache_dir().join(format!("opgg_{}_{}.json", safe_name, role.to_lowercase()));

    if filename.exists() {
        if let Ok(content) = fs::read_to_string(&filename) {
            if let Ok(stats) = serde_json::from_str::<serde_json::Value>(&content) {
                if stats.get("build").is_some() {
                    OPGG_CACHE.lock().unwrap().insert(key, stats.clone());
                    return Some(stats);
                }
            }
        }
    }
    None
}


fn load_settings() {
    let path = get_settings_file();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(s) = serde_json::from_str::<Settings>(&content) {
                *SETTINGS.lock().unwrap() = s;
                println!("[Backend] Successfully loaded settings from {:?}", path);
                return;
            }
        }
    }
    // Save defaults if missing
    let defaults = Settings::default();
    if let Ok(content) = serde_json::to_string_pretty(&defaults) {
        fs::write(&path, content).ok();
    }
    println!("[Backend] Initialized default settings at {:?}", path);
}

fn save_settings(settings: &Settings) {
    let path = get_settings_file();
    if let Ok(content) = serde_json::to_string_pretty(settings) {
        fs::write(&path, content).ok();
        *SETTINGS.lock().unwrap() = settings.clone();
    }
}

// REST Handlers
async fn index_handler() -> impl IntoResponse {
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

async fn static_handler(AxumPath(path): AxumPath<String>) -> impl IntoResponse {
    let clean_path = path.trim_start_matches('/');
    let local_path = PathBuf::from("static").join(clean_path);
    if local_path.exists() {
        if let Ok(content) = fs::read(&local_path) {
            return (
                StatusCode::OK,
                [(header::CONTENT_TYPE, get_content_type(clean_path))],
                content,
            ).into_response();
        }
    }

    match Asset::get(clean_path) {
        Some(content) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, get_content_type(clean_path))],
            content.data.into_owned(),
        ).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn get_champions() -> impl IntoResponse {
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

async fn get_connection_url() -> impl IntoResponse {
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
struct NotesQuery {
    champion: String,
}

async fn get_notes(Query(q): Query<NotesQuery>) -> impl IntoResponse {
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
struct UpdateNotesRequest {
    champion: String,
    note: String,
}

async fn update_notes(Json(req): Json<UpdateNotesRequest>) -> impl IntoResponse {
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

async fn get_settings() -> impl IntoResponse {
    load_settings();
    let s = SETTINGS.lock().unwrap().clone();
    Json(s)
}

async fn update_settings(Json(req): Json<Settings>) -> impl IntoResponse {
    save_settings(&req);
    Json(serde_json::json!({ "success": true }))
}

// Custom Builds File Path
fn get_custom_builds_file() -> PathBuf {
    get_exe_dir().join("custom_builds.json")
}

// Match History File Path
fn get_match_history_file() -> PathBuf {
    get_exe_dir().join("match_history.json")
}

#[derive(Deserialize)]
struct CustomBuildQuery {
    champion: String,
    role: String,
}

#[derive(Deserialize)]
struct SaveCustomBuildRequest {
    champion: String,
    role: String,
    build: serde_json::Value,
}

async fn get_custom_build(Query(q): Query<CustomBuildQuery>) -> impl IntoResponse {
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

async fn save_custom_build(Json(req): Json<SaveCustomBuildRequest>) -> impl IntoResponse {
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

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MatchRecord {
    champion: String,
    role: String,
    cs_min: f64,
    gold_spent: i32,
    duration_sec: i32,
    win: bool,
    timestamp: String,
}

#[derive(Deserialize)]
struct AddMatchRequest {
    champion: String,
    role: String,
    cs_min: f64,
    gold_spent: i32,
    duration_sec: i32,
    win: bool,
}

async fn get_match_history() -> impl IntoResponse {
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

async fn add_match_record(Json(req): Json<AddMatchRequest>) -> impl IntoResponse {
    let path = get_match_history_file();
    let mut history = vec![];
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            history = serde_json::from_str::<Vec<MatchRecord>>(&content).unwrap_or_default();
        }
    }
    
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
    let record = MatchRecord {
        champion: req.champion,
        role: req.role,
        cs_min: req.cs_min,
        gold_spent: req.gold_spent,
        duration_sec: req.duration_sec,
        win: req.win,
        timestamp: now,
    };
    history.push(record);
    
    if let Ok(content) = serde_json::to_string_pretty(&history) {
        fs::write(&path, content).ok();
    }
    Json(serde_json::json!({ "success": true }))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GithubRelease {
    tag_name: String,
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

async fn check_update() -> impl IntoResponse {
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
struct TriggerUpdateRequest {
    download_url: String,
}

async fn trigger_update(Json(req): Json<TriggerUpdateRequest>) -> impl IntoResponse {
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
struct SearchQuery {
    champion: String,
    role: Option<String>,
}

async fn search_champion(Query(q): Query<SearchQuery>) -> impl IntoResponse {
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
struct ImportRunesRequest {
    primary_style_id: i32,
    sub_style_id: i32,
    perk_ids: Vec<i32>,
    shard_ids: Vec<i32>,
    page_name: String,
}

async fn import_runes(Json(req): Json<ImportRunesRequest>) -> impl IntoResponse {
    let mut lcu = LCU_MUTEX.lock().await;
    let res = lcu.import_runes(
        req.primary_style_id,
        req.sub_style_id,
        req.perk_ids,
        req.shard_ids,
        &req.page_name,
    );
    Json(res)
}

// WebSocket Upgrade Handler
async fn ws_handler(
    ws: WebSocketUpgrade,
    State(ctx): State<Arc<AppStateContext>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, ctx))
}

async fn handle_socket(mut socket: AxumWebSocket, ctx: Arc<AppStateContext>) {
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

    let mut recv_task = tokio::spawn(async move {
        use futures_util::StreamExt;
        while let Some(Ok(_)) = receiver.next().await {
            // Keep connection alive, discard client inputs
        }
    });

    tokio::select! {
        _ = (&mut send_task) => recv_task.abort(),
        _ = (&mut recv_task) => send_task.abort(),
    }
}

// Check modifier helper
fn is_modifiers_match(ctrl: bool, alt: bool, shift: bool) -> bool {
    let s = SETTINGS.lock().unwrap();
    if s.hotkey_ctrl && !ctrl { return false; }
    if s.hotkey_alt && !alt { return false; }
    if s.hotkey_shift && !shift { return false; }
    true
}

// Win32 GetAsyncKeyState binding
#[cfg(target_os = "windows")]
extern "system" {
    fn GetAsyncKeyState(v_key: i32) -> i16;
}

// Background thread listening for key presses
fn keyboard_listener_thread(ctx: Arc<AppStateContext>) {
    #[cfg(target_os = "windows")]
    {
        const VK_CONTROL: i32 = 0x11;
        const VK_MENU: i32 = 0x12; // Alt
        const VK_SHIFT: i32 = 0x10;

        let mut triggered_keys = HashMap::new();

        loop {
            std::thread::sleep(Duration::from_millis(80));

            let ctrl_down = unsafe { GetAsyncKeyState(VK_CONTROL) < 0 };
            let alt_down = unsafe { GetAsyncKeyState(VK_MENU) < 0 };
            let shift_down = unsafe { GetAsyncKeyState(VK_SHIFT) < 0 };

            if is_modifiers_match(ctrl_down, alt_down, shift_down) {
                let key_preset = {
                    let s = SETTINGS.lock().unwrap();
                    s.hotkey_keys.clone()
                };

                let base_vk = if key_preset == "1-5" { 0x30 } else { 0x6F };

                for i in 1..=5 {
                    let vk = base_vk + i;
                    let is_down = unsafe { GetAsyncKeyState(vk) < 0 };
                    let is_ult = shift_down; // if not req_shift, shift is ult modifier
                    let key_id = format!("{}_{}", i, is_ult);

                    if is_down {
                        let triggered = triggered_keys.get(&key_id).copied().unwrap_or(false);
                        if !triggered {
                            triggered_keys.insert(key_id, true);
                            let action_type = if is_ult { "hotkey_ult" } else { "hotkey_spell" };
                            let payload = serde_json::json!({
                                "type": action_type,
                                "enemy_index": i - 1
                            });
                            if let Ok(json_str) = serde_json::to_string(&payload) {
                                let _ = ctx.tx.send(json_str);
                            }
                        }
                    } else {
                        triggered_keys.insert(key_id, false);
                    }
                }
            }
        }
    }
}

// Background warmup prefetch task
pub static POPULAR_META_CHAMPIONS: [(&str, &str); 142] = [
    // Top
    ("Garen", "top"), ("Darius", "top"), ("Aatrox", "top"), ("Jax", "top"), ("Malphite", "top"),
    ("Fiora", "top"), ("Gnar", "top"), ("Ornn", "top"), ("Camille", "top"), ("Urgot", "top"),
    ("Sett", "top"), ("KSante", "top"), ("Renekton", "top"), ("Shen", "top"), ("Nasus", "top"),
    ("Teemo", "top"), ("Gwen", "top"), ("Tryndamere", "top"), ("Kayle", "top"), ("ChoGath", "top"),
    ("Mordekaiser", "top"), ("Sion", "top"), ("Singed", "top"), ("Rumble", "top"), ("Yorick", "top"),
    ("Poppy", "top"), ("Volibear", "top"), ("Kennen", "top"), ("Olaf", "top"), ("Jayce", "top"),
    // Jungle
    ("Kayn", "jungle"), ("Lee Sin", "jungle"), ("Graves", "jungle"), ("Hecarim", "jungle"), ("KhaZix", "jungle"),
    ("Viego", "jungle"), ("Nocturne", "jungle"), ("Lillia", "jungle"), ("Master Yi", "jungle"), ("Shaco", "jungle"),
    ("Jarvan IV", "jungle"), ("Ekko", "jungle"), ("Evelynn", "jungle"), ("Elise", "jungle"), ("Gragas", "jungle"),
    ("Nunu", "jungle"), ("Rengar", "jungle"), ("Amumu", "jungle"), ("Rammus", "jungle"), ("Warwick", "jungle"),
    ("Jax", "jungle"), ("Briar", "jungle"), ("Udyr", "jungle"), ("Sejuani", "jungle"), ("Fiddlesticks", "jungle"),
    ("Zac", "jungle"), ("BelVeth", "jungle"), ("Xin Zhao", "jungle"), ("Nidalee", "jungle"), ("Kindred", "jungle"),
    // Mid
    ("Yasuo", "mid"), ("Yone", "mid"), ("Ahri", "mid"), ("Zed", "mid"), ("Lux", "mid"),
    ("Akali", "mid"), ("Sylas", "mid"), ("Katarina", "mid"), ("Syndra", "mid"), ("Orianna", "mid"),
    ("Vex", "mid"), ("Aurelion Sol", "mid"), ("Kassadin", "mid"), ("Fizz", "mid"), ("Leblanc", "mid"),
    ("Viktor", "mid"), ("Veigar", "mid"), ("Galio", "mid"), ("Talon", "mid"), ("Hwei", "mid"),
    ("Vladimir", "mid"), ("Naafiri", "mid"), ("Malzahar", "mid"), ("Zoe", "mid"), ("Lissandra", "mid"),
    ("Tristana", "mid"), ("Corki", "mid"), ("Jayce", "mid"), ("Azir", "mid"), ("Swain", "mid"),
    // ADC
    ("Jinx", "adc"), ("Ezreal", "adc"), ("KaiSa", "adc"), ("Jhin", "adc"), ("Caitlyn", "adc"),
    ("Lucian", "adc"), ("Ashe", "adc"), ("Vayne", "adc"), ("Miss Fortune", "adc"), ("Samira", "adc"),
    ("Twitch", "adc"), ("Aphelios", "adc"), ("Zeri", "adc"), ("Varus", "adc"), ("Draven", "adc"),
    ("Tristana", "adc"), ("Sivir", "adc"), ("Nilah", "adc"), ("KogMaw", "adc"), ("Kalista", "adc"),
    ("Xayah", "adc"), ("Smolder", "adc"),
    // Support
    ("Thresh", "support"), ("Lulu", "support"), ("Lux", "support"), ("Nautilus", "support"), ("Senna", "support"),
    ("Pyke", "support"), ("Blitzcrank", "support"), ("Karma", "support"), ("Morgana", "support"), ("Yuumi", "support"),
    ("Sona", "support"), ("Soraka", "support"), ("Leona", "support"), ("Nami", "support"), ("Bard", "support"),
    ("Milio", "support"), ("Rakan", "support"), ("Janna", "support"), ("Alistar", "support"), ("Xerath", "support"),
    ("Zyra", "support"), ("Brand", "support"), ("Maokai", "support"), ("Taric", "support"), ("Braum", "support"),
    ("Renata Glasc", "support"), ("Zilean", "support"), ("Rell", "support"), ("Hwei", "support"), ("Seraphine", "support"),
];

async fn warmup_meta_cache_task(ctx: Arc<AppStateContext>) {
    println!("[Backend] Starting meta warmup cache prefetch thread...");

    let mut deduped_roster = vec![];
    let mut seen = HashSet::new();

    for &(champ, role) in &POPULAR_META_CHAMPIONS {
        let key = (champ.to_lowercase(), role.to_string());
        if !seen.contains(&key) {
            seen.insert(key);
            deduped_roster.push((champ.to_string(), role.to_string()));
        }
    }

    let total_targets = deduped_roster.len();
    println!("[Backend] Warmup cache contains {} distinct champion-role targets.", total_targets);

    // Initial state setup
    {
        let mut state = ctx.state.write().await;
        state.warmup = Some(serde_json::json!({
            "progress": 0,
            "count": 0,
            "total": total_targets
        }));
    }
    ctx.broadcast().await;

    let mut success_count = 0;

    // Sequentially load or fetch cached targets
    for (champ, role) in &deduped_roster {
        let safe_name = champ.to_lowercase().replace(" ", "").replace("'", "");
        let ugg_path = get_cache_dir().join(format!("ugg_{}_{}.json", safe_name, role.to_lowercase()));
        let opgg_path = get_cache_dir().join(format!("opgg_{}_{}.json", safe_name, role.to_lowercase()));
        
        let mut loaded_any = false;
        let mut did_network_fetch = false;

        // U.GG
        if ugg_path.exists() {
            let c = champ.clone();
            let r = role.clone();
            tokio::task::spawn_blocking(move || get_cached_stats_only_disk(&c, &r));
            loaded_any = true;
        } else {
            let c = champ.clone();
            let r = role.clone();
            tokio::task::spawn_blocking(move || get_cached_stats(&c, &r)).await.unwrap_or(None);
            loaded_any = true;
            did_network_fetch = true;
        }

        // OP.GG
        if opgg_path.exists() {
            let c = champ.clone();
            let r = role.clone();
            tokio::task::spawn_blocking(move || get_cached_opgg_stats_only_disk(&c, &r));
            loaded_any = true;
        } else {
            let c = champ.clone();
            let r = role.clone();
            tokio::task::spawn_blocking(move || get_cached_opgg_stats(&c, &r)).await.unwrap_or(None);
            loaded_any = true;
            did_network_fetch = true;
        }

        if did_network_fetch {
            // Sleep slightly to avoid aggressive rate limiting/Cloudflare blocks if hitting the network
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }

        if loaded_any {
            success_count += 1;
            let pct = ((success_count as f64 / total_targets as f64) * 100.0) as i32;
            {
                let mut state = ctx.state.write().await;
                state.warmup = Some(serde_json::json!({
                    "progress": pct,
                    "count": success_count,
                    "total": total_targets
                }));
            }
            ctx.broadcast().await;
        }
    }

    // Set completed status
    {
        let mut state = ctx.state.write().await;
        state.warmup = Some(serde_json::json!({
            "progress": 100,
            "count": success_count,
            "total": total_targets,
            "completed": true
        }));
    }
    ctx.broadcast().await;
    println!("[Backend] Warmup cache completed. Loaded {}/{} targets from disk.", success_count, total_targets);
}

// Draft Recommendations
fn calculate_draft_suggestions(cs_data: &serde_json::Value) -> serde_json::Value {
    let role = cs_data.get("role").and_then(|v| v.as_str()).unwrap_or("mid").to_lowercase();
    let role_map: HashMap<&str, &str> = [
        ("bottom", "adc"), ("utility", "support"), ("middle", "mid"), ("top", "top"), ("jungle", "jungle")
    ].iter().cloned().collect();
    let std_player_role = role_map.get(role.as_str()).copied().unwrap_or("mid");

    let enemy_picks = cs_data.get("enemy_picks").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let team_picks = cs_data.get("team_picks").and_then(|v| v.as_array()).cloned().unwrap_or_default();

    let mut candidates = vec![];
    let opponent = enemy_picks.iter().find(|e| {
        e.get("role").and_then(|v| v.as_str()).unwrap_or("").to_lowercase() == role
    });

    if let Some(opp) = opponent {
        if let Some(opp_name) = opp.get("name").and_then(|v| v.as_str()) {
            let o_name = opp_name.to_string();
            let o_role = std_player_role.to_string();

            // Run in spawn_blocking equivalent thread block
            let stats_ugg = get_cached_stats(&o_name, &o_role);
            let stats_opgg = get_cached_opgg_stats(&o_name, &o_role);

            let mut c_set = HashSet::new();
            if let Some(ugg) = stats_ugg.as_ref().and_then(|v| v.get("counters")).and_then(|v| v.as_array()) {
                for c in ugg {
                    if let Some(id) = c.get("champion_id").and_then(|v| v.as_i64()) {
                        c_set.insert(id as i32);
                    }
                }
            }
            if let Some(opgg) = stats_opgg.as_ref().and_then(|v| v.get("counters")).and_then(|v| v.as_array()) {
                for c in opgg {
                    if let Some(id) = c.get("champion_id").and_then(|v| v.as_i64()) {
                        c_set.insert(id as i32);
                    }
                }
            }
            candidates = c_set.into_iter().collect();
        }
    } else {
        candidates = DD_MANAGER.champions.keys().cloned().collect();
    }

    let mut team_counters = vec![];
    for &c_id in &candidates {
        let champ_info = DD_MANAGER.get_champion_by_id(c_id);
        if champ_info.key == "Unknown" {
            continue;
        }

        let mut score = 0.0;
        let mut matches_countered = 0;

        for enemy in &enemy_picks {
            if let Some(enemy_name) = enemy.get("name").and_then(|v| v.as_str()) {
                let e_role_raw = enemy.get("role").and_then(|v| v.as_str()).unwrap_or("mid");
                let e_role = role_map.get(e_role_raw.to_lowercase().as_str()).copied().unwrap_or("mid");

                let e_ugg = get_cached_stats(enemy_name, e_role);
                let e_opgg = get_cached_opgg_stats(enemy_name, e_role);

                let mut wr_list = vec![];
                if let Some(ugg) = e_ugg.as_ref().and_then(|v| v.get("counters")).and_then(|v| v.as_array()) {
                    if let Some(ec) = ugg.iter().find(|x| x.get("champion_id").and_then(|v| v.as_i64()).unwrap_or(0) as i32 == c_id) {
                        if let Some(wr) = ec.get("win_rate").and_then(|v| v.as_f64()) {
                            wr_list.push(wr);
                        }
                    }
                }
                if let Some(opgg) = e_opgg.as_ref().and_then(|v| v.get("counters")).and_then(|v| v.as_array()) {
                    if let Some(ec) = opgg.iter().find(|x| x.get("champion_id").and_then(|v| v.as_i64()).unwrap_or(0) as i32 == c_id) {
                        if let Some(wr) = ec.get("win_rate").and_then(|v| v.as_f64()) {
                            wr_list.push(wr);
                        }
                    }
                }

                if !wr_list.is_empty() {
                    let avg_wr = wr_list.iter().sum::<f64>() / wr_list.len() as f64;
                    score += 50.0 - avg_wr;
                    matches_countered += 1;
                }
            }
        }

        if !enemy_picks.is_empty() && matches_countered > 0 {
            let tips_list = get_champion_tips(&champ_info.name);
            let synergy_note = tips_list.first().cloned().unwrap_or_else(|| "Strong overall matchup winrate.".to_string());
            team_counters.push(serde_json::json!({
                "champion_id": c_id,
                "name": champ_info.name.clone(),
                "image": champ_info.image.clone(),
                "score": (score * 100.0).round() / 100.0,
                "matches_countered": matches_countered,
                "synergy_note": synergy_note
            }));
        }
    }

    team_counters.sort_by(|a, b| b["score"].as_f64().unwrap_or(0.0).partial_cmp(&a["score"].as_f64().unwrap_or(0.0)).unwrap_or(std::cmp::Ordering::Equal));
    if team_counters.len() > 3 {
        team_counters.truncate(3);
    }

    // Botlane Suggestions
    let mut botlane_suggestions = vec![];
    if std_player_role == "adc" || std_player_role == "support" {
        let mut ally_bot = None;
        let target_role = if std_player_role == "support" {
            ally_bot = team_picks.iter().find(|p| p.get("role").and_then(|v| v.as_str()).unwrap_or("").to_lowercase() == "bottom").cloned();
            "support"
        } else {
            ally_bot = team_picks.iter().find(|p| p.get("role").and_then(|v| v.as_str()).unwrap_or("").to_lowercase() == "utility").cloned();
            "adc"
        };

        let enemy_adc = enemy_picks.iter().find(|e| e.get("role").and_then(|v| v.as_str()).unwrap_or("").to_lowercase() == "bottom").cloned();
        let enemy_sup = enemy_picks.iter().find(|e| e.get("role").and_then(|v| v.as_str()).unwrap_or("").to_lowercase() == "utility").cloned();

        let bot_candidates: Vec<i32> = DD_MANAGER.champions.keys().cloned().collect();

        let mut synergy_map = HashMap::new();
        if let Some(bot) = &ally_bot {
            if let Some(bot_name) = bot.get("name").and_then(|v| v.as_str()) {
                let role_to_lookup = if std_player_role == "support" { "adc" } else { "support" };
                let ally_stats = get_cached_opgg_stats(bot_name, role_to_lookup);
                if let Some(synergies) = ally_stats.as_ref().and_then(|v| v.get("build")).and_then(|v| v.get("synergies")).and_then(|v| v.get(target_role)).and_then(|v| v.as_array()) {
                    for syn in synergies {
                        if let (Some(id), Some(wr)) = (syn.get("champion_id").and_then(|v| v.as_i64()), syn.get("win_rate").and_then(|v| v.as_f64())) {
                            synergy_map.insert(id as i32, wr);
                        }
                    }
                }
            }
        }

        let supports_set: HashSet<&str> = [
            "Thresh", "Lulu", "Janna", "Nami", "Yuumi", "Soraka", "Sona", "Karma",
            "Braum", "Leona", "Alistar", "Taric", "Rakan", "Pyke", "Nautilus",
            "Blitzcrank", "Bard", "Morgana", "Zyra", "Brand", "Lux", "Senna", "Seraphine",
            "Renata Glasc", "Rell", "Milio", "Hwei"
        ].iter().cloned().collect();

        let adcs_set: HashSet<&str> = [
            "Ashe", "Caitlyn", "Draven", "Ezreal", "Jhin", "Jinx", "Kai'Sa", "Kalista",
            "Kog'Maw", "Lucian", "Miss Fortune", "Samira", "Sivir", "Tristana", "Varus",
            "Vayne", "Xayah", "Zeri", "Aphelios", "Nilah", "Twitch"
        ].iter().cloned().collect();

        let filter_set = if target_role == "support" { supports_set } else { adcs_set };

        for &c_id in &bot_candidates {
            let champ_info = DD_MANAGER.get_champion_by_id(c_id);
            if champ_info.key == "Unknown" || !filter_set.contains(champ_info.name.as_str()) {
                continue;
            }

            let synergy_wr = synergy_map.get(&c_id).copied().unwrap_or(50.0);
            let synergy_delta = synergy_wr - 50.0;

            let mut adc_delta = 0.0;
            if let Some(ref e_adc) = enemy_adc {
                if let Some(e_adc_name) = e_adc.get("name").and_then(|v| v.as_str()) {
                    let adc_ugg = get_cached_stats(e_adc_name, "adc");
                    let adc_opgg = get_cached_opgg_stats(e_adc_name, "adc");
                    let mut wr_list = vec![];
                    if let Some(arr) = adc_ugg.as_ref().and_then(|v| v.get("counters")).and_then(|v| v.as_array()) {
                        if let Some(ec) = arr.iter().find(|x| x.get("champion_id").and_then(|v| v.as_i64()).unwrap_or(0) as i32 == c_id) {
                            if let Some(wr) = ec.get("win_rate").and_then(|v| v.as_f64()) {
                                wr_list.push(wr);
                            }
                        }
                    }
                    if let Some(arr) = adc_opgg.as_ref().and_then(|v| v.get("counters")).and_then(|v| v.as_array()) {
                        if let Some(ec) = arr.iter().find(|x| x.get("champion_id").and_then(|v| v.as_i64()).unwrap_or(0) as i32 == c_id) {
                            if let Some(wr) = ec.get("win_rate").and_then(|v| v.as_f64()) {
                                wr_list.push(wr);
                            }
                        }
                    }
                    if !wr_list.is_empty() {
                        adc_delta = 50.0 - (wr_list.iter().sum::<f64>() / wr_list.len() as f64);
                    }
                }
            }

            let mut sup_delta = 0.0;
            if let Some(ref e_sup) = enemy_sup {
                if let Some(e_sup_name) = e_sup.get("name").and_then(|v| v.as_str()) {
                    let sup_ugg = get_cached_stats(e_sup_name, "support");
                    let sup_opgg = get_cached_opgg_stats(e_sup_name, "support");
                    let mut wr_list = vec![];
                    if let Some(arr) = sup_ugg.as_ref().and_then(|v| v.get("counters")).and_then(|v| v.as_array()) {
                        if let Some(ec) = arr.iter().find(|x| x.get("champion_id").and_then(|v| v.as_i64()).unwrap_or(0) as i32 == c_id) {
                            if let Some(wr) = ec.get("win_rate").and_then(|v| v.as_f64()) {
                                wr_list.push(wr);
                            }
                        }
                    }
                    if let Some(arr) = sup_opgg.as_ref().and_then(|v| v.get("counters")).and_then(|v| v.as_array()) {
                        if let Some(ec) = arr.iter().find(|x| x.get("champion_id").and_then(|v| v.as_i64()).unwrap_or(0) as i32 == c_id) {
                            if let Some(wr) = ec.get("win_rate").and_then(|v| v.as_f64()) {
                                wr_list.push(wr);
                            }
                        }
                    }
                    if !wr_list.is_empty() {
                        sup_delta = 50.0 - (wr_list.iter().sum::<f64>() / wr_list.len() as f64);
                    }
                }
            }

            let score = synergy_delta + adc_delta + sup_delta;
            botlane_suggestions.push(serde_json::json!({
                "champion_id": c_id,
                "name": champ_info.name.clone(),
                "image": champ_info.image.clone(),
                "score": (score * 100.0).round() / 100.0,
                "synergy_wr": (synergy_wr * 10.0).round() / 10.0,
                "enemy_adc_locked": enemy_adc.is_some(),
                "enemy_sup_locked": enemy_sup.is_some(),
                "ally_bot_locked": ally_bot.is_some(),
                "ally_bot_name": ally_bot.as_ref().and_then(|b| b.get("name")).and_then(|v| v.as_str()).unwrap_or("")
            }));
        }

        botlane_suggestions.sort_by(|a, b| b["score"].as_f64().unwrap_or(0.0).partial_cmp(&a["score"].as_f64().unwrap_or(0.0)).unwrap_or(std::cmp::Ordering::Equal));
        if botlane_suggestions.len() > 3 {
            botlane_suggestions.truncate(3);
        }
    }

    // Damage balance calculation
    let mut ally_dmg_ap = 0;
    let mut ally_dmg_ad = 0;
    let mut enemy_dmg_ap = 0;
    let mut enemy_dmg_ad = 0;

    let mut ally_picks_list: Vec<String> = team_picks.iter().filter_map(|p| p.get("name").and_then(|v| v.as_str()).map(|s| s.to_string())).collect();
    if let Some(u_champ) = cs_data.get("champion_name").and_then(|v| v.as_str()) {
        if !u_champ.is_empty() {
            ally_picks_list.push(u_champ.to_string());
        }
    }

    let enemy_picks_list: Vec<String> = enemy_picks.iter().filter_map(|p| p.get("name").and_then(|v| v.as_str()).map(|s| s.to_string())).collect();

    let calc_ratios = |champs: &[String]| -> (i32, i32) {
        if champs.is_empty() {
            return (50, 50);
        }
        let mut ad_count: f64 = 0.0;
        let mut ap_count: f64 = 0.0;
        for c in champs {
            let (profile, _) = DD_MANAGER.get_champion_damage_profile(c);
            if profile == "AP" {
                ap_count += 1.0;
            } else {
                ad_count += 1.0;
            }
        }
        let total: f64 = ad_count + ap_count;
        if total == 0.0 {
            return (50, 50);
        }
        (
            ((ad_count / total) * 100.0).round() as i32,
            ((ap_count / total) * 100.0).round() as i32,
        )
    };

    let (ally_ad, ally_ap) = calc_ratios(&ally_picks_list);
    let (enemy_ad, enemy_ap) = calc_ratios(&enemy_picks_list);

    // Ban recommendations
    let mut ban_rec = serde_json::Value::Null;
    if let Some(user_champ) = cs_data.get("champion_name").and_then(|v| v.as_str()) {
        if !user_champ.is_empty() {
            let ugg_s = get_cached_stats(user_champ, std_player_role);
            let opgg_s = get_cached_opgg_stats(user_champ, std_player_role);
            let mut worst_wr = 0.0;
            let mut worst_name = String::new();
            let mut worst_image = String::new();

            let mut process_counters = |counters_arr: &serde_json::Value| {
                if let Some(arr) = counters_arr.as_array() {
                    for ec in arr {
                        let wr = ec.get("win_rate").and_then(|v| v.as_f64()).unwrap_or(50.0);
                        if worst_name.is_empty() || wr < worst_wr {
                            worst_wr = wr;
                            worst_name = ec.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            worst_image = ec.get("image").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        }
                    }
                }
            };

            if let Some(ugg) = ugg_s.as_ref().and_then(|v| v.get("counters")) {
                process_counters(ugg);
            }
            if let Some(opgg) = opgg_s.as_ref().and_then(|v| v.get("counters")) {
                process_counters(opgg);
            }

            if !worst_name.is_empty() {
                ban_rec = serde_json::json!({
                    "name": worst_name,
                    "image": worst_image,
                    "win_rate": worst_wr
                });
            }
        }
    }

    serde_json::json!({
        "team_counters": team_counters,
        "botlane_suggestions": botlane_suggestions,
        "damage_balance": {
            "ally": { "ad": ally_ad, "ap": ally_ap },
            "enemy": { "ad": enemy_ad, "ap": enemy_ap }
        },
        "ban_recommendation": ban_rec
    })
}

// Check summoner names matching
fn match_summoner(a: &str, b: &str) -> bool {
    // Normalizes gameName#tagLine matching
    let a_clean = a.to_lowercase().replace(" ", "");
    let b_clean = b.to_lowercase().replace(" ", "");
    a_clean == b_clean || a_clean.split('#').next() == b_clean.split('#').next()
}

// Background LCU credentials checking & status polling loop
async fn lcu_monitoring_loop(ctx: Arc<AppStateContext>) {
    let mut prev_phase = "None".to_string();
    let mut prev_cs_data = serde_json::Value::Null;
    let mut enemy_history: HashMap<String, (i64, HashSet<i32>)> = HashMap::new();

    loop {
        tokio::time::sleep(Duration::from_secs(2)).await;

        let mut lcu = LCU_MUTEX.lock().await;

        // Check if game client is responsive directly via port 2999
        let client_live = reqwest::blocking::Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(std::time::Duration::from_millis(800))
            .build();
        let is_live_game_active = if let Ok(client) = client_live {
            client.get("https://127.0.0.1:2999/liveclientdata/allgamedata").send().is_ok()
        } else {
            false
        };

        let mut phase = "None".to_string();
        if is_live_game_active {
            phase = "InProgress".to_string();
        } else if lcu.connect() {
            phase = lcu.get_game_phase();
        }

        if phase != "InProgress" {
            enemy_history.clear();
        }


        let mut state_changed = false;

        // Connect summoner state
        {
            let mut state = ctx.state.write().await;
            if lcu.client.is_some() || is_live_game_active {
                if !state.connected {
                    state.connected = true;
                    state_changed = true;
                }
                if lcu.client.is_some() && state.summoner.is_none() {
                    state.summoner = Some(SummonerInfo {
                        name: lcu.summoner_name.clone(),
                        tag: lcu.summoner_tag.clone(),
                        puuid: lcu.puuid.clone(),
                    });
                    state_changed = true;
                }
            } else if state.connected {
                state.connected = false;
                state_changed = true;
            }
        }

        if phase != prev_phase {
            println!("[Backend] Game phase changed: {} -> {}", prev_phase, phase);
            {
                let mut state = ctx.state.write().await;
                state.phase = phase.clone();
            }
            prev_phase = phase.clone();
            state_changed = true;
        }

        if phase == "ChampSelect" {
            let cs_data_opt = lcu.get_champ_select_data();
            if let Some(cs_data) = cs_data_opt {
                if cs_data != prev_cs_data || state_changed {
                    let local_cell_id = cs_data.get("localPlayerCellId").and_then(|v| v.as_i64()).unwrap_or(0);

                    let mut user_player = None;
                    if let Some(my_team) = cs_data.get("myTeam").and_then(|v| v.as_array()) {
                        user_player = my_team.iter().find(|p| p.get("cellId").and_then(|v| v.as_i64()).unwrap_or(0) == local_cell_id).cloned();
                    }

                    let role = user_player.as_ref()
                        .and_then(|p| p.get("assignedPosition"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("middle")
                        .to_lowercase();

                    let role_map: HashMap<&str, &str> = [
                        ("bottom", "adc"), ("utility", "support"), ("middle", "mid"), ("top", "top"), ("jungle", "jungle")
                    ].iter().cloned().collect();
                    let std_role = role_map.get(role.as_str()).copied().unwrap_or("mid");

                    let mut team_picks = vec![];
                    let mut enemy_picks = vec![];

                    if let Some(my_team) = cs_data.get("myTeam").and_then(|v| v.as_array()) {
                        for p in my_team {
                            let cell_id = p.get("cellId").and_then(|v| v.as_i64()).unwrap_or(0);
                            let c_id = p.get("championId").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
                            if c_id > 0 && cell_id != local_cell_id {
                                let champ = DD_MANAGER.get_champion_by_id(c_id);
                                team_picks.push(serde_json::json!({
                                    "id": c_id,
                                    "name": champ.name,
                                    "key": champ.key,
                                    "image": champ.image,
                                    "role": p.get("assignedPosition").and_then(|v| v.as_str()).unwrap_or("")
                                }));
                            }
                        }
                    }

                    if let Some(their_team) = cs_data.get("theirTeam").and_then(|v| v.as_array()) {
                        for p in their_team {
                            let c_id = p.get("championId").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
                            if c_id > 0 {
                                let champ = DD_MANAGER.get_champion_by_id(c_id);
                                enemy_picks.push(serde_json::json!({
                                    "id": c_id,
                                    "name": champ.name,
                                    "key": champ.key,
                                    "image": champ.image,
                                    "role": p.get("assignedPosition").and_then(|v| v.as_str()).unwrap_or("")
                                }));
                            }
                        }
                    }

                    let user_champ_id = user_player.as_ref().and_then(|p| p.get("championId")).and_then(|v| v.as_i64()).unwrap_or(0) as i32;
                    let user_champ = if user_champ_id > 0 { Some(DD_MANAGER.get_champion_by_id(user_champ_id)) } else { None };

                    let mut is_locked = false;
                    if let Some(actions) = cs_data.get("actions").and_then(|v| v.as_array()) {
                        for turn_group in actions {
                            if let Some(arr) = turn_group.as_array() {
                                for action in arr {
                                    if action.get("actorCellId").and_then(|v| v.as_i64()).unwrap_or(0) == local_cell_id
                                        && action.get("type").and_then(|v| v.as_str()).unwrap_or("") == "pick"
                                    {
                                        is_locked = action.get("completed").and_then(|v| v.as_bool()).unwrap_or(false);
                                    }
                                }
                            }
                        }
                    }

                    let payload = serde_json::json!({
                        "role": role,
                        "champion_name": user_champ.as_ref().map(|c| c.name.clone()).unwrap_or_default(),
                        "champion_key": user_champ.as_ref().map(|c| c.key.clone()).unwrap_or_default(),
                        "champion_image": user_champ.as_ref().map(|c| c.image.clone()).unwrap_or_default(),
                        "champion_id": user_champ_id,
                        "is_locked": is_locked,
                        "enemy_picks": enemy_picks,
                        "team_picks": team_picks
                    });

                    let mut next_champ_select = ChampSelectState {
                        role: role.clone(),
                        champion: user_champ.map(|c| serde_json::json!({
                            "id": c.id,
                            "name": c.name,
                            "key": c.key,
                            "image": c.image
                        })),
                        is_locked,
                        enemy_picks: enemy_picks.clone(),
                        team_picks: team_picks.clone(),
                    };

                    let user_champ_name = next_champ_select.champion.as_ref().and_then(|c| c.get("name")).and_then(|v| v.as_str()).unwrap_or("");
                    if !user_champ_name.is_empty() {
                        let c_name = user_champ_name.to_string();
                        let r_name = std_role.to_string();
                        let stats_ugg = tokio::task::spawn_blocking(move || get_cached_stats(&c_name, &r_name)).await.unwrap_or(None);
                        let c_name = user_champ_name.to_string();
                        let r_name = std_role.to_string();
                        let stats_opgg = tokio::task::spawn_blocking(move || get_cached_opgg_stats(&c_name, &r_name)).await.unwrap_or(None);

                        let tips = get_champion_tips(user_champ_name);

                        let mut state = ctx.state.write().await;
                        state.stats = stats_ugg;
                        state.stats_opgg = stats_opgg;
                        state.tips = Some(tips);
                    }

                    let suggestions = calculate_draft_suggestions(&payload);

                    {
                        let mut state = ctx.state.write().await;
                        state.champ_select = Some(next_champ_select);
                        state.draft_suggestions = Some(suggestions);
                    }

                    prev_cs_data = cs_data;
                    state_changed = true;
                }
            }
        } else if phase == "InProgress" {
            // Continually poll Live Client Data API (port 2999)
            let client_live = reqwest::blocking::Client::builder()
                .danger_accept_invalid_certs(true)
                .timeout(std::time::Duration::from_millis(800))
                .build();

            if let Ok(client) = client_live {
                let res_live = client.get("https://127.0.0.1:2999/liveclientdata/allgamedata").send();
                if let Ok(r) = res_live {
                    if r.status().is_success() {
                        if let Ok(live_data) = r.json::<serde_json::Value>() {
                            let all_players = live_data.get("allPlayers").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                            let game_time = live_data.get("gameData").and_then(|v| v.get("gameTime")).and_then(|v| v.as_f64()).unwrap_or(0.0);
                            let events = live_data.get("events").and_then(|v| v.get("Events")).and_then(|v| v.as_array()).cloned().unwrap_or_default();

                            let mut active_api_name = None;
                            if let Ok(r_name) = client.get("https://127.0.0.1:2999/liveclientdata/activeplayername").send() {
                                active_api_name = r_name.json::<String>().ok();
                            }

                            let our_summoner_name = {
                                let state = ctx.state.read().await;
                                state.summoner.as_ref().map(|s| s.name.clone()).unwrap_or_default()
                            };

                            let active_name_to_match = active_api_name.unwrap_or(our_summoner_name);

                            // Find active player
                            let mut active_p_obj = None;
                            if !active_name_to_match.is_empty() {
                                active_p_obj = all_players.iter().find(|p| {
                                    p.get("summonerName")
                                        .and_then(|v| v.as_str())
                                        .map(|s| match_summoner(s, &active_name_to_match))
                                        .unwrap_or(false)
                                }).cloned();
                            }

                            // Fallback construction of champ_select if LCU is missing
                            let is_cs_missing = {
                                let state = ctx.state.read().await;
                                state.champ_select.is_none()
                            };

                            if is_cs_missing && active_p_obj.is_some() {
                                let ap_obj = active_p_obj.as_ref().unwrap();
                                let champ_name = ap_obj.get("championName").and_then(|v| v.as_str()).unwrap_or("");
                                let user_champ = DD_MANAGER.get_champion_by_name(champ_name);
                                let our_team = ap_obj.get("team").and_then(|v| v.as_str()).unwrap_or("ORDER");

                                let mut enemies = vec![];
                                for p in &all_players {
                                    if p.get("team").and_then(|v| v.as_str()).unwrap_or("ORDER") != our_team {
                                        let ec_name = p.get("championName").and_then(|v| v.as_str()).unwrap_or("");
                                        let echamp = DD_MANAGER.get_champion_by_name(ec_name);
                                        let spells = p.get("summonerSpells").cloned().unwrap_or(serde_json::Value::Null);

                                        let spell_display_to_id: HashMap<&str, i32> = [
                                            ("Cleanse", 1), ("Exhaust", 3), ("Flash", 4), ("Ghost", 6), ("Heal", 7),
                                            ("Smite", 11), ("Teleport", 12), ("Ignite", 14), ("Barrier", 21)
                                        ].iter().cloned().collect();

                                        let s1_name = spells.get("summonerSpellOne").and_then(|s| s.get("displayName")).and_then(|v| v.as_str()).unwrap_or("Flash");
                                        let s2_name = spells.get("summonerSpellTwo").and_then(|s| s.get("displayName")).and_then(|v| v.as_str()).unwrap_or("Ignite");

                                        enemies.push(serde_json::json!({
                                            "id": echamp.as_ref().map(|c| c.id).unwrap_or(0),
                                            "name": ec_name,
                                            "image": echamp.as_ref().map(|c| c.image.clone()).unwrap_or_default(),
                                            "spell1_id": spell_display_to_id.get(s1_name).copied().unwrap_or(4),
                                            "spell2_id": spell_display_to_id.get(s2_name).copied().unwrap_or(14)
                                        }));
                                    }
                                }

                                let pos = ap_obj.get("position").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
                                let role = if pos.contains("support") { "support" } else { "middle" };

                                let c_name_str = champ_name.to_string();
                                let role_str = role.to_string();
                                let stats_ugg = tokio::task::spawn_blocking(move || get_cached_stats(&c_name_str, &role_str)).await.unwrap_or(None);

                                let c_name_str = champ_name.to_string();
                                let role_str = role.to_string();
                                let stats_opgg = tokio::task::spawn_blocking(move || get_cached_opgg_stats(&c_name_str, &role_str)).await.unwrap_or(None);

                                let tips = get_champion_tips(champ_name);

                                let mut state = ctx.state.write().await;
                                state.champ_select = Some(ChampSelectState {
                                    role: role.to_string(),
                                    champion: user_champ.map(|c| serde_json::json!({
                                        "id": c.id,
                                        "name": c.name,
                                        "key": c.key,
                                        "image": c.image
                                    })),
                                    is_locked: true,
                                    enemy_picks: enemies,
                                    team_picks: vec![],
                                });
                                state.stats = stats_ugg;
                                state.stats_opgg = stats_opgg;
                                state.tips = Some(tips);
                                state_changed = true;
                                println!("[Backend] Constructed fallback champ_select from live client: {} ({})", champ_name, role);
                            }

                            // Active player statistics
                            let ap = live_data.get("activePlayer").cloned().unwrap_or(serde_json::Value::Null);
                            let mut ap_gold_total = 0;
                            let mut ap_cs = 0;

                            if let Some(ap_obj) = &active_p_obj {
                                ap_cs = ap_obj.get("scores").and_then(|s| s.get("creepScore")).and_then(|v| v.as_i64()).unwrap_or(0) as i32;
                                if let Some(items) = ap_obj.get("items").and_then(|i| i.as_array()) {
                                    for item in items {
                                        if let Some(item_id) = item.get("itemID").and_then(|v| v.as_i64()) {
                                            let item_data = DD_MANAGER.get_item_by_id(item_id as i32);
                                            ap_gold_total += item_data.gold_total;
                                        }
                                    }
                                }
                            }

                            let active_player_data = serde_json::json!({
                                "level": ap.get("level").and_then(|v| v.as_i64()).unwrap_or(1),
                                "gold": (ap.get("currentGold").and_then(|v| v.as_f64()).unwrap_or(0.0)) as i32,
                                "net_worth": ap_gold_total,
                                "cs": ap_cs
                            });

                            let our_team_name = active_p_obj.as_ref().and_then(|p| p.get("team").and_then(|v| v.as_str())).unwrap_or("ORDER");

                            let mut ally_team = vec![];
                            let mut enemy_team = vec![];
                            let mut active_player_team_idx = 0;

                            for p in &all_players {
                                let t_name = p.get("team").and_then(|v| v.as_str()).unwrap_or("ORDER");
                                if t_name == our_team_name {
                                    ally_team.push(p.clone());
                                    if let Some(p_name) = p.get("summonerName").and_then(|v| v.as_str()) {
                                        if !active_name_to_match.is_empty() && match_summoner(p_name, &active_name_to_match) {
                                            active_player_team_idx = ally_team.len() - 1;
                                        }
                                    }
                                } else {
                                    enemy_team.push(p.clone());
                                }
                            }

                            // Track enemy level and item completion alerts
                            for p in &enemy_team {
                                let ec_name = p.get("championName").and_then(|v| v.as_str()).unwrap_or("");
                                if ec_name.is_empty() {
                                    continue;
                                }
                                let level = p.get("level").and_then(|v| v.as_i64()).unwrap_or(1);
                                
                                let mut current_items = HashSet::new();
                                if let Some(items) = p.get("items").and_then(|i| i.as_array()) {
                                    for item in items {
                                        if let Some(item_id) = item.get("itemID").and_then(|v| v.as_i64()) {
                                            current_items.insert(item_id as i32);
                                        }
                                    }
                                }
                                
                                let entry = enemy_history.entry(ec_name.to_string()).or_insert_with(|| (1, HashSet::new()));
                                let (prev_level, prev_items) = entry;
                                
                                if level == 6 && *prev_level < 6 {
                                    let text = format!("Caution! {} reached level 6, ultimate is active!", ec_name);
                                    let ctx_alert = ctx.clone();
                                    tokio::spawn(async move {
                                        ctx_alert.broadcast_alert(&text).await;
                                    });
                                }
                                *prev_level = level;
                                
                                for &item_id in &current_items {
                                    if !prev_items.contains(&item_id) {
                                        let item_data = DD_MANAGER.get_item_by_id(item_id);
                                        if item_data.gold_total >= 2600 {
                                            let text = format!("{} completed {}!", ec_name, item_data.name);
                                            let ctx_alert = ctx.clone();
                                            tokio::spawn(async move {
                                                ctx_alert.broadcast_alert(&text).await;
                                            });
                                        }
                                    }
                                }
                                *prev_items = current_items;
                            }

                            let mut lane_opponent_name = "Unknown".to_string();
                            let mut lane_opponent_cs = 0;
                            if active_player_team_idx < enemy_team.len() {
                                let opp = &enemy_team[active_player_team_idx];
                                lane_opponent_name = opp.get("championName").and_then(|v| v.as_str()).unwrap_or("Unknown").to_string();
                                lane_opponent_cs = opp.get("scores").and_then(|s| s.get("creepScore")).and_then(|v| v.as_i64()).unwrap_or(0) as i32;
                            }

                            let mut ally_gold_total = 0;
                            let mut enemy_gold_total = 0;

                            for p in &all_players {
                                let mut p_gold = 0;
                                if let Some(items) = p.get("items").and_then(|i| i.as_array()) {
                                    for item in items {
                                        if let Some(item_id) = item.get("itemID").and_then(|v| v.as_i64()) {
                                            let item_data = DD_MANAGER.get_item_by_id(item_id as i32);
                                            p_gold += item_data.gold_total;
                                        }
                                    }
                                }
                                if p.get("team").and_then(|v| v.as_str()).unwrap_or("ORDER") == our_team_name {
                                    ally_gold_total += p_gold;
                                } else {
                                    enemy_gold_total += p_gold;
                                }
                            }

                            {
                                let mut state = ctx.state.write().await;
                                state.live_game = Some(serde_json::json!({
                                    "game_time": game_time,
                                    "events": events,
                                    "active_player": active_player_data,
                                    "ally_gold": ally_gold_total,
                                    "enemy_gold": enemy_gold_total,
                                    "lane_opponent_name": lane_opponent_name,
                                    "lane_opponent_cs": lane_opponent_cs
                                }));
                            }
                            state_changed = true;

                            let mut live_enemies = vec![];
                            for p in &all_players {
                                if p.get("team").and_then(|v| v.as_str()).unwrap_or("ORDER") != our_team_name {
                                    let champ_name = p.get("championName").and_then(|v| v.as_str()).unwrap_or("");
                                    let raw_items = p.get("items").and_then(|i| i.as_array()).cloned().unwrap_or_default();
                                    let mut items = vec![];
                                    let mut has_lucidity = false;

                                    for item in &raw_items {
                                        if let Some(item_id) = item.get("itemID").and_then(|v| v.as_i64()) {
                                            if item_id == 3158 {
                                                has_lucidity = true;
                                            }
                                            let item_data = DD_MANAGER.get_item_by_id(item_id as i32);
                                            items.push(item_data);
                                        }
                                    }

                                    let spells = p.get("summonerSpells").cloned().unwrap_or(serde_json::Value::Null);
                                    let spell_display_to_id: HashMap<&str, i32> = [
                                        ("Cleanse", 1), ("Exhaust", 3), ("Flash", 4), ("Ghost", 6), ("Heal", 7),
                                        ("Smite", 11), ("Teleport", 12), ("Ignite", 14), ("Barrier", 21)
                                    ].iter().cloned().collect();

                                    let s1_name = spells.get("summonerSpellOne").and_then(|s| s.get("displayName")).and_then(|v| v.as_str()).unwrap_or("Flash");
                                    let s2_name = spells.get("summonerSpellTwo").and_then(|s| s.get("displayName")).and_then(|v| v.as_str()).unwrap_or("Ignite");
                                    let s1_id = spell_display_to_id.get(s1_name).copied().unwrap_or(4);
                                    let s2_id = spell_display_to_id.get(s2_name).copied().unwrap_or(14);

                                    let champ_info = DD_MANAGER.get_champion_by_name(champ_name);
                                    let champ_image = champ_info.as_ref().map(|c| c.image.clone()).unwrap_or_default();

                                    live_enemies.push(serde_json::json!({
                                        "id": champ_info.as_ref().map(|c| c.id).unwrap_or(0),
                                        "name": champ_name,
                                        "image": champ_image,
                                        "level": p.get("level").and_then(|v| v.as_i64()).unwrap_or(1),
                                        "scores": {
                                            "kills": p.get("scores").and_then(|s| s.get("kills")).and_then(|v| v.as_i64()).unwrap_or(0),
                                            "deaths": p.get("scores").and_then(|s| s.get("deaths")).and_then(|v| v.as_i64()).unwrap_or(0),
                                            "assists": p.get("scores").and_then(|s| s.get("assists")).and_then(|v| v.as_i64()).unwrap_or(0),
                                            "cs": p.get("scores").and_then(|s| s.get("creepScore")).and_then(|v| v.as_i64()).unwrap_or(0)
                                        },
                                        "items": items,
                                        "has_lucidity": has_lucidity,
                                        "spell1_id": s1_id,
                                        "spell2_id": s2_id,
                                        "respawn_timer": p.get("respawnTimer").and_then(|v| v.as_f64()).unwrap_or(0.0)
                                    }));
                                }
                            }

                            if !live_enemies.is_empty() {
                                let mut state = ctx.state.write().await;
                                if let Some(cs) = &mut state.champ_select {
                                    cs.enemy_picks = live_enemies;
                                    state_changed = true;
                                }
                            }
                        }
                    }
                }
            }
        } else {
            // Normal/None/Lobby state
            let mut state = ctx.state.write().await;
            if state.champ_select.is_some() {
                state.champ_select = None;
                state.stats = None;
                state.stats_opgg = None;
                state.tips = None;
                state.draft_suggestions = None;
                state.live_game = None;
                state_changed = true;
            }
            prev_cs_data = serde_json::Value::Null;
        }

        if state_changed {
            ctx.broadcast().await;
        }
    }
}

// Browser automation on start
fn open_browser() {
    std::thread::sleep(Duration::from_millis(1500));
    println!("[Backend] Automatically opening web browser dashboard...");
    let _ = webbrowser::open("http://localhost:8000");
}

#[tokio::main]
async fn main() {
    load_settings();

    let ctx = AppStateContext::new();

    // Spawn win32 keypress listener
    let ctx_keys = ctx.clone();
    std::thread::spawn(move || keyboard_listener_thread(ctx_keys));

    // Spawn LCU monitoring loop
    let ctx_lcu = ctx.clone();
    tokio::spawn(lcu_monitoring_loop(ctx_lcu));

    // Spawn stats warmup prefetcher
    let ctx_warmup = ctx.clone();
    tokio::spawn(warmup_meta_cache_task(ctx_warmup));

    // Serve static files and REST endpoints
    let app = Router::new()
        .route("/", get(index_handler))
        .route("/static/*path", get(static_handler))
        .route("/api/champions", get(get_champions))
        .route("/api/connection-url", get(get_connection_url))
        .route("/api/notes", get(get_notes).post(update_notes))
        .route("/api/settings", get(get_settings).post(update_settings))
        .route("/api/search", get(search_champion))
        .route("/api/import-runes", post(import_runes))
        .route("/api/custom-builds", get(get_custom_build).post(save_custom_build))
        .route("/api/match-history", get(get_match_history).post(add_match_record))
        .route("/api/check-update", get(check_update))
        .route("/api/trigger-update", post(trigger_update))
        .route("/ws", get(ws_handler))
        .layer(CorsLayer::permissive())
        .with_state(ctx);

    // Spawn browser launcher
    std::thread::spawn(open_browser);

    println!("[Backend] Launching Rust Web Server on http://localhost:8000...");
    let listener = tokio::net::TcpListener::bind("127.0.0.1:8000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
