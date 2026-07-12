use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::time::Duration;
use crate::core::state::{AppStateContext, ChampSelectState};
use crate::providers::ddragon::DD_MANAGER;
use crate::providers::cache::{get_cached_stats, get_cached_opgg_stats};
use crate::core::draft::get_champion_tips;

// Check summoner names matching
pub fn match_summoner(a: &str, b: &str) -> bool {
    // Normalizes gameName#tagLine matching
    let a_clean = a.to_lowercase().replace(" ", "");
    let b_clean = b.to_lowercase().replace(" ", "");
    a_clean == b_clean || a_clean.split('#').next() == b_clean.split('#').next()
}

pub async fn live_client_polling_loop(ctx: Arc<AppStateContext>) {
    let mut enemy_history: HashMap<String, (i64, HashSet<i32>)> = HashMap::new();

    let spell_display_to_id: HashMap<&str, i32> = [
        ("Cleanse", 1), ("Exhaust", 3), ("Flash", 4), ("Ghost", 6), ("Heal", 7),
        ("Smite", 11), ("Teleport", 12), ("Ignite", 14), ("Barrier", 21)
    ].iter().cloned().collect();

    let client_live = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_millis(800))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let mut prev_live_game_json = String::new();

    loop {
        tokio::time::sleep(Duration::from_millis(500)).await;

        let our_summoner_name = {
            let state = ctx.state.read().await;
            state.summoner.as_ref().map(|s| s.name.clone()).unwrap_or_default()
        };

        let mut live_data_opt = None;
        {
            let res_live = client_live.get("https://127.0.0.1:2999/liveclientdata/allgamedata").send().await;
            if let Ok(r) = res_live {
                if r.status().is_success() {
                    if let Ok(live_data) = r.json::<serde_json::Value>().await {
                        live_data_opt = Some(live_data);
                    }
                }
            }
        }

        if live_data_opt.is_none() {
            let phase = {
                let state = ctx.state.read().await;
                state.phase.clone()
            };
            if phase != "InProgress" {
                if !enemy_history.is_empty() {
                    enemy_history.clear();
                }
                continue;
            }
            continue;
        }

        // Force transition phase to InProgress since we successfully got live client data!
        {
            let mut state = ctx.state.write().await;
            if state.phase != "InProgress" {
                println!("[Live Client] Port 2999 responsive. Forcing phase to InProgress.");
                state.phase = "InProgress".to_string();
                // Spawn a broadcast in the background to avoid holding lock
                let ctx_clone = ctx.clone();
                tokio::spawn(async move {
                    ctx_clone.broadcast().await;
                });
            }
        }

        let live_data = live_data_opt.unwrap();
        let all_players = live_data.get("allPlayers").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        let game_time = live_data.get("gameData").and_then(|v| v.get("gameTime")).and_then(|v| v.as_f64()).unwrap_or(0.0);
        let events = live_data.get("events").and_then(|v| v.get("Events")).and_then(|v| v.as_array()).cloned().unwrap_or_default();

        let mut active_api_name = None;
        if let Ok(r_name) = client_live.get("https://127.0.0.1:2999/liveclientdata/activeplayername").send().await {
            active_api_name = r_name.json::<String>().await.ok();
        }

        // Save raw debug snapshot once per game for diagnosis
        let debug_path = std::path::PathBuf::from("live_client_debug.json");
        if !debug_path.exists() {
            let debug_data = serde_json::json!({
                "activeplayername_result": active_api_name.clone(),
                "our_summoner_name": our_summoner_name.clone(),
                "activePlayer_keys": live_data.get("activePlayer").map(|v| {
                    v.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()).unwrap_or_default()
                }),
                "activePlayer_summonerName": live_data.get("activePlayer").and_then(|a| a.get("summonerName")),
                "activePlayer_riotIdGameName": live_data.get("activePlayer").and_then(|a| a.get("riotIdGameName")),
                "allPlayers_count": all_players.len(),
                "allPlayers_sample": all_players.iter().map(|p| {
                    serde_json::json!({
                        "summonerName": p.get("summonerName"),
                        "riotIdGameName": p.get("riotIdGameName"),
                        "riotId": p.get("riotId"),
                        "championName": p.get("championName"),
                        "team": p.get("team"),
                        "position": p.get("position"),
                        "all_keys": p.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()).unwrap_or_default()
                    })
                }).collect::<Vec<_>>()
            });
            if let Ok(content) = serde_json::to_string_pretty(&debug_data) {
                std::fs::write(&debug_path, content).ok();
                println!("[Live Client] Debug snapshot saved to live_client_debug.json");
            }
        }

        let active_name_to_match = active_api_name.unwrap_or_else(|| our_summoner_name.clone());

        let mut active_p_obj = None;
        if !active_name_to_match.is_empty() {
            active_p_obj = all_players.iter().find(|p| {
                // Try riotIdGameName first (new API), then summonerName (legacy), then riotId
                let riot_name = p.get("riotIdGameName").and_then(|v| v.as_str());
                let summoner_name = p.get("summonerName").and_then(|v| v.as_str());
                let riot_id = p.get("riotId").and_then(|v| v.as_str());
                riot_name.map(|s| match_summoner(s, &active_name_to_match)).unwrap_or(false)
                    || summoner_name.map(|s| match_summoner(s, &active_name_to_match)).unwrap_or(false)
                    || riot_id.map(|s| match_summoner(s.split('#').next().unwrap_or(s), &active_name_to_match)).unwrap_or(false)
            }).cloned();
        }

        // Log diagnostic info on first poll or when player not found
        if game_time < 5.0 || active_p_obj.is_none() {
            println!("[Live Client] Active name from API: '{}', found player: {}", active_name_to_match, active_p_obj.is_some());
            println!("[Live Client] Total players in allPlayers: {}", all_players.len());
            for (i, p) in all_players.iter().enumerate() {
                let sn = p.get("summonerName").and_then(|v| v.as_str()).unwrap_or("??");
                let rn = p.get("riotIdGameName").and_then(|v| v.as_str()).unwrap_or("??");
                let ri = p.get("riotId").and_then(|v| v.as_str()).unwrap_or("??");
                let cn = p.get("championName").and_then(|v| v.as_str()).unwrap_or("??");
                let tm = p.get("team").and_then(|v| v.as_str()).unwrap_or("??");
                println!("[Live Client]   Player {}: summonerName='{}', riotIdGameName='{}', riotId='{}', champ='{}', team='{}'", i, sn, rn, ri, cn, tm);
            }
        }
        if active_p_obj.is_none() {
            let state = ctx.state.read().await;
            if let Some(cs) = &state.champ_select {
                if let Some(champ) = &cs.champion {
                    if let Some(champ_name) = champ.get("name").and_then(|v| v.as_str()) {
                        active_p_obj = all_players.iter().find(|p| {
                            p.get("championName").and_then(|v| v.as_str()).unwrap_or("") == champ_name
                        }).cloned();
                        if active_p_obj.is_some() {
                            println!("[Live Client] Found player via champ_select champion name: {}", champ_name);
                        }
                    }
                }
            }
        }

        // Fallback 3: Use activePlayer.riotIdGameName or summonerName from live_data to re-match
        if active_p_obj.is_none() {
            let ap = live_data.get("activePlayer");
            let ap_riot = ap.and_then(|a| a.get("riotIdGameName")).and_then(|v| v.as_str());
            let ap_sn = ap.and_then(|a| a.get("summonerName")).and_then(|v| v.as_str());
            let name_to_try = ap_riot.or(ap_sn);
            if let Some(ap_name) = name_to_try {
                active_p_obj = all_players.iter().find(|p| {
                    let sn = p.get("summonerName").and_then(|v| v.as_str()).unwrap_or("");
                    let rn = p.get("riotIdGameName").and_then(|v| v.as_str()).unwrap_or("");
                    match_summoner(sn, ap_name) || match_summoner(rn, ap_name)
                }).cloned();
                if active_p_obj.is_some() {
                    println!("[Live Client] Found player via activePlayer name: {}", ap_name);
                }
            }
        }

        let is_cs_missing = {
            let state = ctx.state.read().await;
            state.champ_select.is_none()
        };

        let mut state_changed = false;

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
            let role = match pos.as_str() {
                "utility" => "support",
                "bottom" => "adc",
                "middle" => "mid",
                "jungle" => "jungle",
                "top" => "top",
                _ => "mid",
            };

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
            state_changed = true;

            let c_name = champ_name.to_string();
            let r_name = role.to_string();
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
                
                if current_champ.to_lowercase() == c_name.to_lowercase() {
                    state.stats = stats_ugg;
                    state.stats_opgg = stats_opgg;
                    state.tips = Some(tips);
                    drop(state);
                    ctx_clone.broadcast().await;
                }
            });
            println!("[Backend] Constructed fallback champ_select from live client: {} ({})", champ_name, role);
        } else if is_cs_missing && active_p_obj.is_none() {
            // Ultimate fallback: use activePlayer data from live_data even when we can't find ourselves in allPlayers
            let ap = live_data.get("activePlayer");
            let ap_champ_name = ap.and_then(|a| a.get("championName")).and_then(|v| v.as_str())
                .or_else(|| {
                    // Try to get champion name from the /activeplayername endpoint result
                    // and cross-reference with allPlayers
                    None
                });
            
            if let Some(champ_name) = ap_champ_name {
                println!("[Live Client] Ultimate fallback: using activePlayer championName '{}'", champ_name);
                let user_champ = DD_MANAGER.get_champion_by_name(champ_name);
                
                // Since we don't know our team, put ALL other champions as enemies
                let mut enemies = vec![];
                for p in &all_players {
                    let ec_name = p.get("championName").and_then(|v| v.as_str()).unwrap_or("");
                    if !ec_name.is_empty() && ec_name != champ_name {
                        let echamp = DD_MANAGER.get_champion_by_name(ec_name);
                        let spells = p.get("summonerSpells").cloned().unwrap_or(serde_json::Value::Null);
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

                let mut state = ctx.state.write().await;
                state.champ_select = Some(ChampSelectState {
                    role: "mid".to_string(), // Default role since we can't determine it
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
                state_changed = true;
                println!("[Backend] Ultimate fallback champ_select from activePlayer: {}", champ_name);
            }
        }

        // Dynamic role update fallback (if we initially guessed "mid" because position was empty)
        let mut cs_updated = false;
        {
            let mut state = ctx.state.write().await;
            if let Some(cs) = &mut state.champ_select {
                let ap_pos = active_p_obj.as_ref().and_then(|p| p.get("position").and_then(|v| v.as_str())).unwrap_or("");
                if !ap_pos.is_empty() && ap_pos != "NONE" {
                    let new_role = match ap_pos.to_lowercase().as_str() {
                        "utility" => "support",
                        "bottom" => "adc",
                        "jungle" => "jungle",
                        "top" => "top",
                        _ => "mid",
                    }.to_string();
                    if cs.role != new_role {
                        println!("[Live Client] Updating role from '{}' to '{}' due to live position update", cs.role, new_role);
                        cs.role = new_role;
                        // Clear stats to force re-fetch
                        state.stats = None;
                        state.stats_opgg = None;
                        state.tips = None;
                        cs_updated = true;
                    }
                }
            }
        }
        if cs_updated {
            state_changed = true;
        }

        // Ensure stats are loaded whenever we know the champion but stats are missing
        {
            let state = ctx.state.read().await;
            let stats_missing = state.stats.is_none() && state.stats_opgg.is_none();
            let champ_name_opt = state.champ_select.as_ref()
                .and_then(|cs| cs.champion.as_ref())
                .and_then(|c| c.get("name"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let role_opt = state.champ_select.as_ref()
                .map(|cs| cs.role.clone());
            
            if stats_missing {
                if let (Some(c_name), Some(role)) = (champ_name_opt, role_opt) {
                    println!("[Live Client] Stats missing for {} ({}), fetching...", c_name, role);
                    let role_mapped = match role.as_str() {
                        "utility" => "support",
                        "bottom" => "adc", 
                        "middle" => "mid",
                        _ => &role,
                    }.to_string();
                    let ctx_clone = ctx.clone();
                    tokio::spawn(async move {
                        let c1 = c_name.clone();
                        let r1 = role_mapped.clone();
                        let stats_ugg = tokio::task::spawn_blocking(move || get_cached_stats(&c1, &r1)).await.unwrap_or(None);

                        let c2 = c_name.clone();
                        let r2 = role_mapped.clone();
                        let stats_opgg = tokio::task::spawn_blocking(move || get_cached_opgg_stats(&c2, &r2)).await.unwrap_or(None);

                        let tips = get_champion_tips(&c_name);

                        let mut state = ctx_clone.state.write().await;
                        // Only update if stats are still missing (avoid race)
                        if state.stats.is_none() && state.stats_opgg.is_none() {
                            state.stats = stats_ugg;
                            state.stats_opgg = stats_opgg;
                            state.tips = Some(tips);
                            drop(state);
                            ctx_clone.broadcast().await;
                            println!("[Live Client] Stats loaded for {}", c_name);
                        }
                    });
                }
            }
        }

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

        for p in &all_players {
            let t_name = p.get("team").and_then(|v| v.as_str()).unwrap_or("ORDER");
            if t_name == our_team_name {
                ally_team.push(p.clone());
            } else {
                enemy_team.push(p.clone());
            }
        }

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
                    crate::core::voice::speak(&ctx_alert, &text).await;
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
                            crate::core::voice::speak(&ctx_alert, &text).await;
                        });
                    }
                }
            }
            *prev_items = current_items;
        }

        let mut lane_opponent_name = "Unknown".to_string();
        let mut lane_opponent_cs = 0;
        if let Some(pos) = active_p_obj.as_ref().and_then(|p| p.get("position").and_then(|v| v.as_str())) {
            if let Some(opp) = enemy_team.iter().find(|e| e.get("position").and_then(|v| v.as_str()) == Some(pos)) {
                lane_opponent_name = opp.get("championName").and_then(|v| v.as_str()).unwrap_or("Unknown").to_string();
                lane_opponent_cs = opp.get("scores").and_then(|s| s.get("creepScore")).and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            }
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

        // Only broadcast if live_game data actually changed
        let live_game_json = {
            let state = ctx.state.read().await;
            state.live_game.as_ref().map(|v| v.to_string()).unwrap_or_default()
        };
        if live_game_json != prev_live_game_json {
            prev_live_game_json = live_game_json;
            state_changed = true;
        }

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

        if state_changed {
            ctx.broadcast().await;
        }
    }
}
