use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;
use tokio::time::Duration;
use futures_util::{SinkExt, StreamExt};
use native_tls::TlsConnector;
use tokio_tungstenite::{connect_async_tls_with_config, Connector};
use tokio_tungstenite::tungstenite::Message;

use crate::core::state::{AppStateContext, ChampSelectState, SummonerInfo};
use crate::providers::ddragon::DD_MANAGER;
use crate::clients::lcu::{LcuManager, find_lcu_credentials};
use crate::providers::cache::{get_cached_stats, get_cached_opgg_stats};
use crate::core::draft::{calculate_draft_suggestions, get_champion_tips};
use crate::clients::live_client::live_client_polling_loop;

lazy_static::lazy_static! {
    pub static ref LCU_MUTEX: Arc<TokioMutex<LcuManager>> = Arc::new(TokioMutex::new(LcuManager::new()));
}

fn base64_encode(input: &str) -> String {
    const CHARSET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let b1 = bytes[i];
        let b2 = if i + 1 < bytes.len() { bytes[i + 1] } else { 0 };
        let b3 = if i + 2 < bytes.len() { bytes[i + 2] } else { 0 };

        let enc1 = b1 >> 2;
        let enc2 = ((b1 & 3) << 4) | (b2 >> 4);
        let enc3 = ((b2 & 15) << 2) | (b3 >> 6);
        let enc4 = b3 & 63;

        result.push(CHARSET[enc1 as usize] as char);
        result.push(CHARSET[enc2 as usize] as char);
        if i + 1 < bytes.len() {
            result.push(CHARSET[enc3 as usize] as char);
        } else {
            result.push('=');
        }
        if i + 2 < bytes.len() {
            result.push(CHARSET[enc4 as usize] as char);
        } else {
            result.push('=');
        }
        i += 3;
    }
    result
}

async fn connect_lcu_ws(port: u16, password: &str) -> Result<tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>, String> {
    let tls_connector = TlsConnector::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| e.to_string())?;
    let connector = Connector::NativeTls(tls_connector);

    let url = format!("wss://127.0.0.1:{}/", port);
    let auth_value = format!("Basic {}", base64_encode(&format!("riot:{}", password)));

    let request = tokio_tungstenite::tungstenite::http::Request::builder()
        .uri(&url)
        .header("Authorization", auth_value)
        .header("Sec-WebSocket-Key", tokio_tungstenite::tungstenite::handshake::client::generate_key())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Host", format!("127.0.0.1:{}", port))
        .body(())
        .map_err(|e| e.to_string())?;

    let (ws, _) = connect_async_tls_with_config(request, None, false, Some(connector))
        .await
        .map_err(|e| e.to_string())?;

    Ok(ws)
}

pub async fn update_lobby_and_matchmaking(lcu: &mut LcuManager, ctx: &AppStateContext) {
    let lobby_data = lcu.get_lobby_data().await;
    let matchmaking_search = lcu.get_matchmaking_search().await;
    
    let mut lobby_members = vec![];
    let mut queue_id = 0;
    
    if let Some(lobby) = &lobby_data {
        queue_id = lobby.get("queueId").and_then(|v| v.as_i64()).unwrap_or(0);
        if let Some(members) = lobby.get("members").and_then(|v| v.as_array()) {
            for m in members {
                let summoner_name = m.get("summonerName").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let summoner_id = m.get("summonerId").and_then(|v| v.as_i64()).unwrap_or(0);
                let puuid = m.get("puuid").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let summoner_level = m.get("summonerLevel").and_then(|v| v.as_i64()).unwrap_or(1);
                let first_pos = m.get("firstPositionPreference").and_then(|v| v.as_str()).unwrap_or("UNSELECTED").to_string();
                let second_pos = m.get("secondPositionPreference").and_then(|v| v.as_str()).unwrap_or("UNSELECTED").to_string();
                
                let mut rank_tier = "UNRANKED".to_string();
                let mut rank_division = "".to_string();
                let mut rank_lp = 0;
                
                if !puuid.is_empty() {
                    if let Some(ranked_val) = lcu.get_ranked_stats(&puuid).await {
                        if let Some(queues) = ranked_val.get("queues").and_then(|v| v.as_array()) {
                            let mut found_queue = queues.iter().find(|q| q.get("queueType").and_then(|v| v.as_str()).unwrap_or("") == "RANKED_SOLO_5x5");
                            if found_queue.is_none() {
                                found_queue = queues.first();
                            }
                            if let Some(q) = found_queue {
                                rank_tier = q.get("tier").and_then(|v| v.as_str()).unwrap_or("UNRANKED").to_string();
                                rank_division = q.get("division").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                rank_lp = q.get("leaguePoints").and_then(|v| v.as_i64()).unwrap_or(0);
                            }
                        }
                    }
                }
                
                lobby_members.push(serde_json::json!({
                    "name": summoner_name,
                    "summoner_id": summoner_id,
                    "puuid": puuid,
                    "level": summoner_level,
                    "first_pos": first_pos,
                    "second_pos": second_pos,
                    "rank_tier": rank_tier,
                    "rank_division": rank_division,
                    "rank_lp": rank_lp
                }));
            }
        }
    }
    
    let mut search_state = "None".to_string();
    let mut est_queue_time = 0.0;
    let mut time_in_queue = 0.0;
    
    if let Some(search) = &matchmaking_search {
        search_state = search.get("searchState").and_then(|v| v.as_str()).unwrap_or("None").to_string();
        est_queue_time = search.get("estimatedQueueTime").and_then(|v| v.as_f64()).unwrap_or(0.0);
        time_in_queue = search.get("timeInQueue").and_then(|v| v.as_f64()).unwrap_or(0.0);
    }
    
    let lobby_payload = serde_json::json!({
        "queue_id": queue_id,
        "members": lobby_members,
        "search_state": search_state,
        "estimated_queue_time": est_queue_time,
        "time_in_queue": time_in_queue
    });

    {
        let mut state = ctx.state.write().await;
        state.matchmaking_or_lobby = Some(lobby_payload);
    }
}

pub async fn handle_champ_select_update(
    cs_data: serde_json::Value,
    ctx: Arc<AppStateContext>,
    prev_cs_data: &mut serde_json::Value,
    state_changed: &mut bool,
) {
    let local_cell_id = cs_data.get("localPlayerCellId").and_then(|v| v.as_i64()).unwrap_or(-1);
    if local_cell_id < 0 {
        return;
    }
    if cs_data != *prev_cs_data {

        let mut user_player = None;
        if local_cell_id >= 0 {
            if let Some(my_team) = cs_data.get("myTeam").and_then(|v| v.as_array()) {
                user_player = my_team.iter().find(|p| p.get("cellId").and_then(|v| v.as_i64()).unwrap_or(-1) == local_cell_id).cloned();
            }
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

        let get_champ_id_for_cell = |cell_id: i64, p: &serde_json::Value, cs_data: &serde_json::Value| -> i32 {
            // 1. Direct championId on the player object (set when pick is locked)
            let mut c_id = p.get("championId").and_then(|v| v.as_i64()).unwrap_or(0) as i32;

            // 2. Check championPickIntent (set when hovering a champion before locking)
            if c_id == 0 {
                c_id = p.get("championPickIntent").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            }

            // 3. Scan actions array for pick actions (fallback for mid-pick states)
            if c_id == 0 {
                if let Some(actions) = cs_data.get("actions").and_then(|v| v.as_array()) {
                    for turn_group in actions {
                        if let Some(arr) = turn_group.as_array() {
                            for action in arr {
                                if action.get("actorCellId").and_then(|v| v.as_i64()).unwrap_or(-1) == cell_id
                                    && action.get("type").and_then(|v| v.as_str()).unwrap_or("") == "pick"
                                {
                                    if let Some(act_champ_id) = action.get("championId").and_then(|v| v.as_i64()) {
                                        if act_champ_id > 0 {
                                            c_id = act_champ_id as i32;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            c_id
        };

        let mut team_picks = vec![];
        let mut enemy_picks = vec![];

        if let Some(my_team) = cs_data.get("myTeam").and_then(|v| v.as_array()) {
            for p in my_team {
                let cell_id = p.get("cellId").and_then(|v| v.as_i64()).unwrap_or(0);
                let c_id = get_champ_id_for_cell(cell_id, p, &cs_data);
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
                let cell_id = p.get("cellId").and_then(|v| v.as_i64()).unwrap_or(0);
                let c_id = get_champ_id_for_cell(cell_id, p, &cs_data);
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

        let user_champ_id = user_player.as_ref().map(|p| get_champ_id_for_cell(local_cell_id, p, &cs_data)).unwrap_or(0);
        let user_champ = if user_champ_id > 0 { Some(DD_MANAGER.get_champion_by_id(user_champ_id)) } else { None };

        let mut is_locked = false;
        if let Some(actions) = cs_data.get("actions").and_then(|v| v.as_array()) {
            for turn_group in actions {
                if let Some(arr) = turn_group.as_array() {
                    for action in arr {
                        if action.get("actorCellId").and_then(|v| v.as_i64()).unwrap_or(-1) == local_cell_id
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

        let next_champ_select = ChampSelectState {
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

        let suggestions = tokio::task::spawn_blocking(move || calculate_draft_suggestions(&payload))
            .await
            .unwrap_or_else(|_| serde_json::Value::Null);

        {
            let mut state = ctx.state.write().await;
            state.champ_select = Some(next_champ_select.clone());
            state.draft_suggestions = Some(suggestions);
        }

        let user_champ_name = next_champ_select.champion.as_ref().and_then(|c| c.get("name")).and_then(|v| v.as_str()).unwrap_or("");
        if !user_champ_name.is_empty() {
            let c_name = user_champ_name.to_string();
            let r_name = std_role.to_string();
            let ctx_clone = ctx.clone();
            tokio::spawn(async move {
                let c_name_ugg = c_name.clone();
                let r_name_ugg = r_name.clone();
                let stats_ugg = tokio::task::spawn_blocking(move || get_cached_stats(&c_name_ugg, &r_name_ugg)).await.unwrap_or(None);

                let c_name_opgg = c_name.clone();
                let r_name_opgg = r_name.clone();
                let stats_opgg = tokio::task::spawn_blocking(move || get_cached_opgg_stats(&c_name_opgg, &r_name_opgg)).await.unwrap_or(None);

                let tips = get_champion_tips(&c_name);

                let mut state = ctx_clone.state.write().await;
                let current_champ = state.champ_select.as_ref()
                    .and_then(|cs| cs.champion.as_ref())
                    .and_then(|c| c.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                
                println!("[LCU WS Stats] Downloaded stats for '{}' ({}). Active hovered champion in state: '{}'", 
                    c_name, r_name, current_champ);
                println!("[LCU WS Stats] Retrieved UGG: {}, OPGG: {}", stats_ugg.is_some(), stats_opgg.is_some());

                if current_champ.to_lowercase() == c_name.to_lowercase() {
                    state.stats = stats_ugg;
                    state.stats_opgg = stats_opgg;
                    state.tips = Some(tips);
                    drop(state);
                    ctx_clone.broadcast().await;
                    println!("[LCU WS Stats] Successfully wrote stats to AppState and broadcasted!");
                } else {
                    println!("[LCU WS Stats] Mismatch! Did not write stats to state.");
                }
            });
        }

        *prev_cs_data = cs_data;
        *state_changed = true;
    }
}

pub async fn lcu_monitoring_loop(ctx: Arc<AppStateContext>) {
    // Spawn the Live Game Client Port 2999 Polling Task concurrently!
    let ctx_live = ctx.clone();
    tokio::spawn(live_client_polling_loop(ctx_live));

    let mut prev_cs_data = serde_json::Value::Null;

    loop {
        let creds_opt = find_lcu_credentials();
        let creds = match creds_opt {
            Some(c) => c,
            None => {
                // If credentials are not found, LCU is closed
                {
                    let mut state = ctx.state.write().await;
                    if state.connected {
                        state.connected = false;
                        state.summoner = None;
                        state.matchmaking_or_lobby = None;
                        state.champ_select = None;
                        state.live_game = None;
                        state.phase = "None".to_string();
                        drop(state);
                        ctx.broadcast().await;
                    }
                }
                tokio::time::sleep(Duration::from_secs(2)).await;
                continue;
            }
        };

        // Try to connect to WebSocket
        println!("[LCU WS] Attempting to connect to LCU WebSocket on port {}...", creds.port);
        let ws_result = connect_lcu_ws(creds.port, &creds.password).await;

        let mut ws_stream = match ws_result {
            Ok(stream) => stream,
            Err(e) => {
                println!("[LCU WS] Connection failed: {}. Retrying in 2 seconds...", e);
                tokio::time::sleep(Duration::from_secs(2)).await;
                continue;
            }
        };

        println!("[LCU WS] Successfully connected to LCU WebSocket!");

        // Establish REST client state immediately
        {
            let mut lcu = LCU_MUTEX.lock().await;
            let mut state = ctx.state.write().await;
            state.connected = true; // Always set to true since we successfully connected to the LCU WebSocket!
            if lcu.connect().await {
                state.summoner = Some(SummonerInfo {
                    name: lcu.summoner_name.clone(),
                    tag: lcu.summoner_tag.clone(),
                    puuid: lcu.puuid.clone(),
                });
                
                let phase = lcu.get_game_phase().await;
                state.phase = phase.clone();
                println!("[LCU WS] Initial game phase: {}", phase);
                drop(state);
                
                // Fetch initial lobby
                update_lobby_and_matchmaking(&mut lcu, &ctx).await;
            } else {
                println!("[LCU WS] REST API not ready yet. Initializing default state.");
                state.summoner = None;
                state.phase = "None".to_string();
                drop(state);
            }
            ctx.broadcast().await;
        }

        // Subscribe to all JSON API events
        if let Err(e) = ws_stream.send(Message::Text("[5, \"OnJsonApiEvent\"]".to_string())).await {
            println!("[LCU WS] Failed to subscribe to events: {}", e);
            tokio::time::sleep(Duration::from_secs(2)).await;
            continue;
        }

        // Listen to WebSocket messages
        while let Some(msg_res) = ws_stream.next().await {
            let msg = match msg_res {
                Ok(m) => m,
                Err(e) => {
                    println!("[LCU WS] Error reading message: {}", e);
                    break;
                }
            };

            if let Message::Text(text) = msg {
                if text.contains("/lol-champ-select/v1/session") || text.contains("/lol-gameflow/v1/gameflow-phase") {
                    println!("[LCU WS] Event detected: {}", text);
                }
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                    if let Some(arr) = val.as_array() {
                        if arr.len() >= 3 && arr[0].as_i64() == Some(8) {
                            let payload = &arr[2];
                            if let (Some(uri), Some(data)) = (payload.get("uri").and_then(|v| v.as_str()), payload.get("data")) {
                                let mut state_changed = false;

                                if uri == "/lol-summoner/v1/current-summoner" {
                                    if let (Some(name), Some(tag), Some(puuid)) = (
                                        data.get("gameName").or_else(|| data.get("displayName")).and_then(|v| v.as_str()),
                                        data.get("tagLine").and_then(|v| v.as_str()),
                                        data.get("puuid").and_then(|v| v.as_str())
                                    ) {
                                        let mut state = ctx.state.write().await;
                                        state.summoner = Some(SummonerInfo {
                                            name: name.to_string(),
                                            tag: tag.to_string(),
                                            puuid: puuid.to_string(),
                                        });
                                        state_changed = true;
                                    }
                                } else if uri == "/lol-gameflow/v1/gameflow-phase" {
                                    if let Some(phase) = data.as_str() {
                                        let mut state = ctx.state.write().await;
                                        if state.phase != phase {
                                            println!("[LCU WS] Game phase changed to: {}", phase);
                                            state.phase = phase.to_string();
                                            state_changed = true;
                                            
                                            if phase != "InProgress" && phase != "ChampSelect" && phase != "GameStart" {
                                                state.champ_select = None;
                                                state.stats = None;
                                                state.stats_opgg = None;
                                                state.tips = None;
                                                state.draft_suggestions = None;
                                                state.live_game = None;
                                                prev_cs_data = serde_json::Value::Null;
                                            }
                                        }
                                    }
                                } else if uri == "/lol-champ-select/v1/session" {
                                    handle_champ_select_update(data.clone(), ctx.clone(), &mut prev_cs_data, &mut state_changed).await;
                                } else if uri == "/lol-lobby/v2/lobby" || uri == "/lol-lobby/v2/lobby/matchmaking/search" {
                                    let mut lcu = LCU_MUTEX.lock().await;
                                    update_lobby_and_matchmaking(&mut lcu, &ctx).await;
                                    state_changed = true;
                                }

                                if state_changed {
                                    ctx.broadcast().await;
                                }
                            }
                        }
                    }
                }
            }
        }

        // Connection lost
        println!("[LCU WS] LCU connection closed. Reconnecting...");
        {
            let mut state = ctx.state.write().await;
            state.connected = false;
            state.summoner = None;
            state.matchmaking_or_lobby = None;
            state.champ_select = None;
            state.live_game = None;
            state.phase = "None".to_string();
            drop(state);
            ctx.broadcast().await;
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}
