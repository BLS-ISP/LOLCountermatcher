use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use crate::ddragon::{Item, Rune, DD_MANAGER};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummonerSpellInfo {
    pub id: i32,
    pub name: String,
    pub image: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UggRunes {
    pub primary_style: Rune,
    pub sub_style: Rune,
    pub perks: Vec<Rune>,
    pub shards: Vec<Rune>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UggBuild {
    pub runes: UggRunes,
    pub starting_items: Vec<Item>,
    pub core_items: Vec<Item>,
    pub situational_items: Vec<Item>,
    pub skill_priority: String,
    pub skill_path: Vec<i64>,
    pub summoner_spells: Vec<SummonerSpellInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UggCounter {
    pub champion_id: i32,
    pub name: String,
    pub key: String,
    pub image: String,
    pub win_rate: f64,
    pub matches: i64,
    pub gold_adv_15: f64,
    pub xp_adv_15: f64,
    pub cs_adv_15: f64,
    pub kill_adv_15: f64,
    pub team_gold_difference_15: f64,
    pub mobafire_guide_url: String,
    pub mobafire_counters_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UggChampionStats {
    pub champion: String,
    pub role: String,
    pub build: Option<UggBuild>,
    pub counters: Vec<UggCounter>,
}

pub fn clean_champ_name(name: &str) -> String {
    name.to_lowercase()
        .replace("'", "")
        .replace(" ", "")
        .replace(".", "")
}

pub fn get_role_map(role: &str) -> &'static str {
    match role.to_lowercase().as_str() {
        "middle" | "mid" => "mid",
        "top" => "top",
        "jungle" => "jungle",
        "bottom" | "adc" => "adc",
        "utility" | "support" => "support",
        _ => "mid",
    }
}

fn parse_ssr(html: &str) -> Option<serde_json::Value> {
    if let Some(idx) = html.find("window.__SSR_DATA__") {
        if let Some(start) = html[idx..].find('{') {
            let start_idx = idx + start;
            let mut bracket_count = 0;
            let mut end_idx = None;
            let bytes = html.as_bytes();
            for j in start_idx..bytes.len() {
                let char = bytes[j] as char;
                if char == '{' {
                    bracket_count += 1;
                } else if char == '}' {
                    bracket_count -= 1;
                    if bracket_count == 0 {
                        end_idx = Some(j + 1);
                        break;
                    }
                }
            }
            if let Some(end) = end_idx {
                let json_str = &html[start_idx..end];
                return serde_json::from_str(json_str).ok();
            }
        }
    }
    None
}

pub fn fetch_champion_stats(champion_name: &str, role: &str) -> UggChampionStats {
    let ugg_role = get_role_map(role);
    let champ_url_name = clean_champ_name(champion_name);
    let rank = "emerald_plus";
    let region = "world";

    let headers = {
        let mut h = reqwest::header::HeaderMap::new();
        h.insert(
            reqwest::header::USER_AGENT,
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36".parse().unwrap()
        );
        h
    };

    let client = reqwest::blocking::Client::builder()
        .default_headers(headers)
        .timeout(std::time::Duration::from_secs(10))
        .build();

    let client = match client {
        Ok(c) => c,
        Err(_) => return UggChampionStats {
            champion: champion_name.to_string(),
            role: role.to_string(),
            build: None,
            counters: vec![],
        },
    };

    let build_url = format!("https://u.gg/lol/champions/{}/build?rank={}&region={}", champ_url_name, rank, region);
    let counter_url = format!("https://u.gg/lol/champions/{}/counter?rank={}&region={}", champ_url_name, rank, region);

    let mut build_data = None;
    let mut counters = vec![];

    // 1. Fetch Build
    let mut build_ssr = None;
    match client.get(&build_url).send() {
        Ok(res) => {
            println!("[U.GG] Build request for {} {} - Status: {}", champion_name, role, res.status());
            if !res.status().is_success() {
                if res.status() == reqwest::StatusCode::FORBIDDEN {
                    println!("[U.GG] ERROR: HTTP 403 Forbidden. Likely blocked by Cloudflare for Build data.");
                } else {
                    println!("[U.GG] ERROR: HTTP Error {}", res.status());
                }
            } else {
                if let Ok(body_text) = res.text() {
                    if body_text.contains("Attention Required! | Cloudflare") || body_text.contains("cf-browser-verification") {
                         println!("[U.GG] ERROR: Cloudflare captcha/verification page detected for Build data!");
                    } else {
                         println!("[U.GG] Successfully fetched Build data. Body size: {} bytes", body_text.len());
                         build_ssr = parse_ssr(&body_text);
                    }
                }
            }
        }
        Err(e) => {
            println!("[U.GG] ERROR: Failed to send Build request for {} {}: {:?}", champion_name, role, e);
        }
    }

    // 2. Fetch Counters
    let mut counter_ssr = None;
    match client.get(&counter_url).send() {
        Ok(res) => {
            println!("[U.GG] Counter request for {} {} - Status: {}", champion_name, role, res.status());
            if !res.status().is_success() {
                if res.status() == reqwest::StatusCode::FORBIDDEN {
                    println!("[U.GG] ERROR: HTTP 403 Forbidden. Likely blocked by Cloudflare for Counter data.");
                } else {
                    println!("[U.GG] ERROR: HTTP Error {}", res.status());
                }
            } else {
                if let Ok(body_text) = res.text() {
                    if body_text.contains("Attention Required! | Cloudflare") || body_text.contains("cf-browser-verification") {
                         println!("[U.GG] ERROR: Cloudflare captcha/verification page detected for Counter data!");
                    } else {
                         println!("[U.GG] Successfully fetched Counter data. Body size: {} bytes", body_text.len());
                         counter_ssr = parse_ssr(&body_text);
                    }
                }
            }
        }
        Err(e) => {
            println!("[U.GG] ERROR: Failed to send Counter request for {} {}: {:?}", champion_name, role, e);
        }
    }

    let role_key = format!("{}_{}_{}", region, rank, ugg_role);

    // 3. Process Build
    if let Some(ssr) = build_ssr {
        if let Some(ssr_obj) = ssr.as_object() {
            let overview_key = ssr_obj.keys().find(|k| k.contains("overview") && k.contains("recommended"));
            if let Some(okey) = overview_key {
                if let Some(overview_dict) = ssr_obj.get(okey).and_then(|v| v.get("data")).and_then(|v| v.as_object()) {
                    let mut actual_key = role_key.clone();
                    if !overview_dict.contains_key(&actual_key) {
                        if let Some(found_key) = overview_dict.keys().find(|k| k.ends_with(&format!("_{}", ugg_role))) {
                            actual_key = found_key.clone();
                        }
                    }

                    if let Some(role_build) = overview_dict.get(&actual_key) {
                        // Resolve Runes
                        let rec_runes = role_build.get("rec_runes");
                        let primary_id = rec_runes.and_then(|r| r.get("primary_style")).and_then(|v| v.as_i64()).unwrap_or(0) as i32;
                        let sub_id = rec_runes.and_then(|r| r.get("sub_style")).and_then(|v| v.as_i64()).unwrap_or(0) as i32;

                        let primary_style = DD_MANAGER.get_rune_by_id(primary_id);
                        let sub_style = DD_MANAGER.get_rune_by_id(sub_id);

                        let mut perks = vec![];
                        if let Some(perk_ids) = rec_runes.and_then(|r| r.get("active_perks")).and_then(|v| v.as_array()) {
                            for p_val in perk_ids {
                                if let Some(p_id) = p_val.as_i64() {
                                    perks.push(DD_MANAGER.get_rune_by_id(p_id as i32));
                                }
                            }
                        }

                        // Resolve Shards
                        let mut shards = vec![];
                        if let Some(shard_ids) = role_build.get("stat_shards").and_then(|s| s.get("active_shards")).and_then(|v| v.as_array()) {
                            for s_val in shard_ids {
                                if let Some(s_id) = s_val.as_i64() {
                                    shards.push(DD_MANAGER.get_rune_by_id(s_id as i32));
                                }
                            }
                        }

                        // Resolve Starter Items
                        let mut starting_items = vec![];
                        if let Some(item_ids) = role_build.get("rec_starting_items").and_then(|s| s.get("ids")).and_then(|v| v.as_array()) {
                            for i_val in item_ids {
                                if let Some(i_id) = i_val.as_i64() {
                                    starting_items.push(DD_MANAGER.get_item_by_id(i_id as i32));
                                }
                            }
                        }

                        // Resolve Core Items
                        let mut core_items = vec![];
                        if let Some(item_ids) = role_build.get("rec_core_items").and_then(|s| s.get("ids")).and_then(|v| v.as_array()) {
                            for i_val in item_ids {
                                if let Some(i_id) = i_val.as_i64() {
                                    core_items.push(DD_MANAGER.get_item_by_id(i_id as i32));
                                }
                            }
                        }

                        // Resolve Situational Items
                        let mut situational_items = vec![];
                        for opt in &["item_options_1", "item_options_2"] {
                            if let Some(opts) = role_build.get(*opt).and_then(|v| v.as_array()) {
                                for item_dict in opts {
                                    if let Some(i_id) = item_dict.get("id").and_then(|v| v.as_i64()) {
                                        situational_items.push(DD_MANAGER.get_item_by_id(i_id as i32));
                                    }
                                }
                            }
                        }
                        if situational_items.len() > 6 {
                            situational_items.truncate(6);
                        }

                        // Resolve Summoners
                        let mut summoner_spells = vec![];
                        let summoner_names: HashMap<i32, &str> = [
                            (1, "Cleanse"), (3, "Exhaust"), (4, "Flash"), (6, "Ghost"), (7, "Heal"),
                            (11, "Smite"), (12, "Teleport"), (14, "Ignite"), (21, "Barrier")
                        ].iter().cloned().collect();

                        let summoner_filenames: HashMap<i32, &str> = [
                            (1, "SummonerBoost"), (3, "SummonerExhaust"), (4, "SummonerFlash"),
                            (6, "SummonerHaste"), (7, "SummonerHeal"), (11, "SummonerSmite"),
                            (12, "SummonerTeleport"), (14, "SummonerDot"), (21, "SummonerBarrier")
                        ].iter().cloned().collect();

                        if let Some(spell_ids) = role_build.get("rec_summoner_spells").and_then(|s| s.get("ids")).and_then(|v| v.as_array()) {
                            for s_val in spell_ids {
                                if let Some(s_id) = s_val.as_i64() {
                                    let s_id_i32 = s_id as i32;
                                    let img_name = summoner_filenames.get(&s_id_i32).copied().unwrap_or("SummonerFlash");
                                    summoner_spells.push(SummonerSpellInfo {
                                        id: s_id_i32,
                                        name: summoner_names.get(&s_id_i32).copied().unwrap_or("Flash").to_string(),
                                        image: format!("https://ddragon.leagueoflegends.com/cdn/{}/img/spell/{}.png", DD_MANAGER.version, img_name),
                                    });
                                }
                            }
                        }

                        // Resolve Skill Path
                        let mut skill_path = vec![];
                        if let Some(rec_skill_path) = role_build.get("rec_skill_path") {
                            if let Some(slots) = rec_skill_path.get("slots").and_then(|v| v.as_array()) {
                                for val in slots {
                                    if let Some(n) = val.as_i64() {
                                        skill_path.push(n);
                                    }
                                }
                            } else if let Some(arr) = rec_skill_path.as_array() {
                                for val in arr {
                                    if let Some(n) = val.as_i64() {
                                        skill_path.push(n);
                                    }
                                }
                            }
                        }

                        let skill_priority = role_build
                            .get("rec_skills")
                            .and_then(|s| s.get("priority"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("Q > W > E")
                            .to_string();

                        build_data = Some(UggBuild {
                            runes: UggRunes {
                                primary_style,
                                sub_style,
                                perks,
                                shards,
                            },
                            starting_items,
                            core_items,
                            situational_items,
                            skill_priority,
                            skill_path,
                            summoner_spells,
                        });
                    }
                }
            }
        }
    }

    // 4. Process Counters
    if let Some(ssr) = counter_ssr {
        if let Some(ssr_obj) = ssr.as_object() {
            let matchups_key = ssr_obj.keys().find(|k| k.contains("matchups"));
            if let Some(mkey) = matchups_key {
                if let Some(matchups_dict) = ssr_obj.get(mkey).and_then(|v| v.get("data")).and_then(|v| v.as_object()) {
                    let mut actual_key = role_key.clone();
                    if !matchups_dict.contains_key(&actual_key) {
                        if let Some(found_key) = matchups_dict.keys().find(|k| k.ends_with(&format!("_{}", ugg_role))) {
                            actual_key = found_key.clone();
                        }
                    }

                    if let Some(role_matchups) = matchups_dict.get(&actual_key) {
                        if let Some(raw_counters) = role_matchups.get("counters").and_then(|v| v.as_array()) {
                            for c in raw_counters {
                                let c_id = c.get("champion_id").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
                                let champ_info = DD_MANAGER.get_champion_by_id(c_id);
                                let win_rate = c.get("win_rate").and_then(|v| v.as_f64()).unwrap_or(50.0);
                                let matches = c.get("matches").and_then(|v| v.as_i64()).unwrap_or(0);

                                counters.push(UggCounter {
                                    champion_id: c_id,
                                    name: champ_info.name.clone(),
                                    key: champ_info.key.clone(),
                                    image: champ_info.image.clone(),
                                    win_rate,
                                    matches,
                                    gold_adv_15: -c.get("gold_adv_15").and_then(|v| v.as_f64()).unwrap_or(0.0),
                                    xp_adv_15: -c.get("xp_adv_15").and_then(|v| v.as_f64()).unwrap_or(0.0),
                                    cs_adv_15: -c.get("cs_adv_15").and_then(|v| v.as_f64()).unwrap_or(0.0),
                                    kill_adv_15: -c.get("kill_adv_15").and_then(|v| v.as_f64()).unwrap_or(0.0),
                                    team_gold_difference_15: -c.get("team_gold_difference_15").and_then(|v| v.as_f64()).unwrap_or(0.0),
                                    mobafire_guide_url: format!("https://www.mobafire.com/league-of-legends/champion/{}", clean_champ_name(&champ_info.name)),
                                    mobafire_counters_url: format!("https://www.mobafire.com/league-of-legends/champion/{}/counters", clean_champ_name(&champ_info.name)),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // Sort matchups by win rate ascending (hardest counters first)
    counters.sort_by(|a, b| a.win_rate.partial_cmp(&b.win_rate).unwrap_or(std::cmp::Ordering::Equal));

    UggChampionStats {
        champion: champion_name.to_string(),
        role: role.to_string(),
        build: build_data,
        counters,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ugg_fetch_stats() {
        let stats = fetch_champion_stats("Ahri", "mid");
        assert_eq!(stats.champion, "Ahri");
        assert_eq!(stats.role, "mid");
        assert!(stats.build.is_some(), "Should parse U.GG recommended build");
        assert!(!stats.counters.is_empty(), "Should parse U.GG counter matchups list");
    }
}
