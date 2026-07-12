use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::fs;
use tokio::time::Duration;
use crate::core::state::AppStateContext;
use crate::providers::ddragon::DD_MANAGER;
use crate::providers::cache::{
    get_tips_file, get_cache_dir, get_cached_stats, get_cached_opgg_stats,
    get_cached_stats_only_disk, get_cached_opgg_stats_only_disk
};

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

pub fn get_champion_tips(champ_name: &str) -> Vec<String> {
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

pub fn calculate_draft_suggestions(cs_data: &serde_json::Value) -> serde_json::Value {
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
        // Synergy drafting if no opponent lane match yet
        let mut synergy_champs = vec![];
        for tp in &team_picks {
            if let Some(tp_name) = tp.get("name").and_then(|v| v.as_str()) {
                let tp_role = tp.get("role").and_then(|v| v.as_str()).unwrap_or("");
                let std_tp_role = role_map.get(tp_role).copied().unwrap_or("mid");
                let stats = get_cached_stats(tp_name, std_tp_role);
                if let Some(ugg) = stats.as_ref().and_then(|v| v.get("counters")).and_then(|v| v.as_array()) {
                    for c in ugg {
                        if let Some(id) = c.get("champion_id").and_then(|v| v.as_i64()) {
                            synergy_champs.push(id as i32);
                        }
                    }
                }
            }
        }
        
        let mut counts = HashMap::new();
        for &id in &synergy_champs {
            *counts.entry(id).or_insert(0) += 1;
        }
        let mut sorted: Vec<(i32, i32)> = counts.into_iter().collect();
        sorted.sort_by(|a, b| b.1.cmp(&a.1));
        candidates = sorted.iter().map(|pair| pair.0).take(10).collect();
    }

    // Filter candidates by our pool
    let final_suggestions: Vec<serde_json::Value> = candidates.iter().map(|&id| {
        let champ = DD_MANAGER.get_champion_by_id(id);
        serde_json::json!({
            "id": id,
            "name": champ.name,
            "key": champ.key,
            "image": champ.image
        })
    }).collect();

    serde_json::json!({
        "suggestions": final_suggestions
    })
}

pub async fn warmup_meta_cache_task(ctx: Arc<AppStateContext>) {
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

        let loaded_any;
        let mut did_network_fetch = false;

        // Check if both files exist and are fresh (<24h)
        let ugg_fresh = ugg_path.exists() && fs::metadata(&ugg_path).and_then(|m| m.modified()).map(|mod_t| mod_t.elapsed().map(|el| el.as_secs() < 86400).unwrap_or(false)).unwrap_or(false);
        let opgg_fresh = opgg_path.exists() && fs::metadata(&opgg_path).and_then(|m| m.modified()).map(|mod_t| mod_t.elapsed().map(|el| el.as_secs() < 86400).unwrap_or(false)).unwrap_or(false);

        if ugg_fresh && opgg_fresh {
            // Load disk cache into memory
            let c = champ.clone();
            let r = role.clone();
            tokio::task::spawn_blocking(move || get_cached_stats_only_disk(&c, &r));
            
            let c_opgg = champ.clone();
            let r_opgg = role.clone();
            tokio::task::spawn_blocking(move || get_cached_opgg_stats_only_disk(&c_opgg, &r_opgg));
            loaded_any = true;
        } else {
            let c = champ.clone();
            let r = role.clone();
            let _stats = tokio::task::spawn_blocking(move || get_cached_stats(&c, &r)).await.unwrap_or(None);
            
            let c_opgg = champ.clone();
            let r_opgg = role.clone();
            let _stats_op = tokio::task::spawn_blocking(move || get_cached_opgg_stats(&c_opgg, &r_opgg)).await.unwrap_or(None);
            loaded_any = true;
            did_network_fetch = true;
        }

        if loaded_any {
            success_count += 1;
        }

        {
            let mut state = ctx.state.write().await;
            state.warmup = Some(serde_json::json!({
                "progress": ((success_count as f32 / total_targets as f32) * 100.0) as i32,
                "count": success_count,
                "total": total_targets
            }));
        }
        ctx.broadcast().await;

        // Slow down cache prefetch on network fetches to avoid rate limit or timeout triggers
        if did_network_fetch {
            tokio::time::sleep(Duration::from_millis(1500)).await;
        } else {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    println!("[Backend] Warmup cache completed. Loaded {}/{} targets from disk.", success_count, total_targets);
}
