mod core;
mod clients;
mod providers;
mod server;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use axum::{
    routing::{get, post},
    Router,
};
use rust_embed::RustEmbed;

use crate::core::state::AppStateContext;
use crate::core::settings::{load_settings, SETTINGS};
use crate::providers::ddragon::DD_MANAGER;
use crate::core::draft::warmup_meta_cache_task;
use crate::clients::lcu_ws::lcu_monitoring_loop;
use crate::server::routes;

#[derive(RustEmbed)]
#[folder = "static/"]
pub struct Asset;

// Check modifier helper for hotkeys
fn is_modifiers_match(ctrl: bool, alt: bool, shift: bool) -> bool {
    let s = SETTINGS.lock().unwrap();
    if s.hotkey_ctrl && !ctrl { return false; }
    if !s.hotkey_ctrl && ctrl { return false; }
    if s.hotkey_alt && !alt { return false; }
    if !s.hotkey_alt && alt { return false; }
    if s.hotkey_shift && !shift { return false; }
    if !s.hotkey_shift && shift { return false; }
    true
}

// Win32 GetAsyncKeyState binding for hotkey listener
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

                let base_vk = if key_preset == "1-5" { 0x30 } else { 0x60 };

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

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let demo_mode = args.iter().any(|a| a == "--demo");

    // Load local settings or persist defaults
    load_settings();

    // Load Riot Data Dragon
    println!("[Backend] Initializing Data Dragon manager...");
    tokio::task::spawn_blocking(|| {
        lazy_static::initialize(&DD_MANAGER);
    }).await.unwrap();
    println!("[Backend] Data Dragon manager initialized successfully!");

    let ctx = AppStateContext::new();

    if demo_mode {
        println!("[Backend] *** DEMO MODE *** — Simulating in-game state with mock data");
        spawn_demo_state(ctx.clone()).await;
    } else {
        // Spawn meta prefetching warm-up task
        let ctx_warmup = ctx.clone();
        tokio::spawn(warmup_meta_cache_task(ctx_warmup));

        // Spawn LCU API and live client polling loop
        let ctx_lcu = ctx.clone();
        tokio::spawn(lcu_monitoring_loop(ctx_lcu));

        // Spawn low-level global keypress hook listener
        let ctx_keyboard = ctx.clone();
        std::thread::spawn(move || {
            keyboard_listener_thread(ctx_keyboard);
        });
    }

    let app = Router::new()
        .route("/", get(routes::index_handler))
        .route("/index.html", get(routes::index_handler))
        .route("/static/*path", get(routes::static_handler))
        .route("/api/champions", get(routes::get_champions))
        .route("/api/connection-url", get(routes::get_connection_url))
        .route("/api/notes", get(routes::get_notes).post(routes::update_notes))
        .route("/api/settings", get(routes::get_settings).post(routes::update_settings))
        .route("/api/custom-build", get(routes::get_custom_build).post(routes::save_custom_build))
        .route("/api/match-history", get(routes::get_match_history).post(routes::add_match_record))
        .route("/api/optimize-build", post(routes::optimize_build))
        .route("/api/check-update", get(routes::check_update))
        .route("/api/trigger-update", post(routes::trigger_update))
        .route("/api/search", get(routes::search_champion))
        .route("/api/import-runes", post(routes::import_runes))
        .route("/api/debug-live", get(routes::debug_live_data))
        .route("/ws", get(routes::ws_handler))
        .with_state(ctx.clone());

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8000").await.unwrap();
    println!("[Backend] Launching Rust Web Server on http://localhost:8000...");

    // Auto open browser on local client start
    let _ = std::process::Command::new("cmd")
        .args(&["/c", "start", "http://localhost:8000"])
        .spawn();

    axum::serve(listener, app).await.unwrap();
}

async fn spawn_demo_state(ctx: Arc<AppStateContext>) {
    use crate::core::state::{SummonerInfo, ChampSelectState};
    use crate::providers::cache::{get_cached_stats, get_cached_opgg_stats};
    use crate::core::draft::get_champion_tips;

    let user_champ_name = "Vel'Koz";
    let user_role = "support";
    let user_champ = DD_MANAGER.get_champion_by_name(user_champ_name);

    // Enemy team setup
    let enemy_champs = vec![
        ("Jinx", "adc", 7, 3, 5, 142, 6),
        ("Thresh", "support", 2, 5, 12, 34, 3),
        ("Yasuo", "mid", 10, 4, 3, 198, 8),
        ("Lee Sin", "jungle", 5, 6, 8, 105, 4),
        ("Darius", "top", 4, 2, 1, 167, 5),
    ];

    let mut enemies = vec![];
    for (name, _role, kills, deaths, assists, cs, items_count) in &enemy_champs {
        let champ = DD_MANAGER.get_champion_by_name(name);
        let mut items = vec![];
        // Add some real items for each enemy
        let item_ids: Vec<i32> = match *name {
            "Jinx" => vec![3031, 3085, 3006, 3072, 3036, 3094],
            "Thresh" => vec![3190, 3109, 3117, 3107],
            "Yasuo" => vec![3153, 6672, 3006, 3046, 3031],
            "Lee Sin" => vec![6693, 3071, 3111, 3156],
            "Darius" => vec![6631, 3053, 3047, 3742, 3065],
            _ => vec![],
        };
        for &id in item_ids.iter().take(*items_count) {
            items.push(DD_MANAGER.get_item_by_id(id));
        }

        enemies.push(serde_json::json!({
            "id": champ.as_ref().map(|c| c.id).unwrap_or(0),
            "name": name,
            "image": champ.as_ref().map(|c| c.image.clone()).unwrap_or_default(),
            "level": 11 + kills / 3,
            "scores": {
                "kills": kills,
                "deaths": deaths,
                "assists": assists,
                "cs": cs
            },
            "items": items,
            "has_lucidity": *name == "Thresh",
            "spell1_id": 4,  // Flash
            "spell2_id": if *name == "Lee Sin" { 11 } else { 14 }, // Smite or Ignite
            "respawn_timer": if *name == "Yasuo" { 15.0 } else { 0.0 }
        }));
    }

    // Load stats for user champion
    let stats_ugg = tokio::task::spawn_blocking(move || {
        get_cached_stats(user_champ_name, user_role)
    }).await.unwrap_or(None);

    let c2 = user_champ_name.to_string();
    let r2 = user_role.to_string();
    let stats_opgg = tokio::task::spawn_blocking(move || {
        get_cached_opgg_stats(&c2, &r2)
    }).await.unwrap_or(None);

    let tips = get_champion_tips(user_champ_name);

    // Set initial state
    {
        let mut state = ctx.state.write().await;
        state.connected = true;
        state.phase = "InProgress".to_string();
        state.summoner = Some(SummonerInfo {
            name: "DemoPlayer".to_string(),
            tag: "EUW".to_string(),
            puuid: "demo-puuid-12345".to_string(),
        });
        state.champ_select = Some(ChampSelectState {
            role: user_role.to_string(),
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
        state.live_game = Some(serde_json::json!({
            "game_time": 845.0,
            "events": [],
            "active_player": {
                "level": 13,
                "gold": 1240,
                "net_worth": 8750,
                "cs": 42
            },
            "ally_gold": 38500,
            "enemy_gold": 36200,
            "lane_opponent_name": "Jinx",
            "lane_opponent_cs": 142
        }));
    }
    ctx.broadcast().await;

    // Tick game time forward every 1s
    let ctx_tick = ctx.clone();
    tokio::spawn(async move {
        let mut game_time = 845.0;
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            game_time += 1.0;
            let mut state = ctx_tick.state.write().await;
            if let Some(lg) = &mut state.live_game {
                lg["game_time"] = serde_json::json!(game_time);
                // Slowly increase gold
                lg["ally_gold"] = serde_json::json!(38500 + ((game_time - 845.0) * 15.0) as i32);
                lg["enemy_gold"] = serde_json::json!(36200 + ((game_time - 845.0) * 14.0) as i32);
            }
            drop(state);
            ctx_tick.broadcast().await;
        }
    });

    println!("[Demo] State populated: {} {} vs 5 enemies, game_time=845s", user_champ_name, user_role);
    println!("[Demo] Stats loaded: UGG={}, OPGG={}", 
        ctx.state.read().await.stats.is_some(),
        ctx.state.read().await.stats_opgg.is_some());
}
