use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use crate::providers::ddragon::{Item, DD_MANAGER};
use crate::providers::ugg::{SummonerSpellInfo, UggCounter, UggRunes};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SynergyItem {
    pub champion_id: Option<i32>,
    pub name: Option<String>,
    pub win_rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpggSynergies {
    pub support: Vec<SynergyItem>,
    pub adc: Vec<SynergyItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpggBuild {
    pub runes: UggRunes,
    pub starting_items: Vec<Item>,
    pub core_items: Vec<Item>,
    pub situational_items: Vec<Item>,
    pub skill_priority: String,
    pub skill_path: Vec<i64>,
    pub summoner_spells: Vec<SummonerSpellInfo>,
    pub synergies: OpggSynergies,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpggChampionStats {
    pub champion: String,
    pub role: String,
    pub build: Option<OpggBuild>,
    pub counters: Vec<UggCounter>,
}

pub fn clean_opgg_champ_name(name: &str) -> String {
    if let Some(champ) = DD_MANAGER.get_champion_by_name(name) {
        let key = &champ.key; // e.g., 'MonkeyKing'
        let mut snake = String::new();
        for (idx, c) in key.chars().enumerate() {
            if idx > 0 && c.is_uppercase() {
                snake.push('_');
            }
            snake.push(c.to_ascii_uppercase());
        }
        return snake;
    }
    name.to_uppercase().replace(" ", "_").replace("'", "")
}

pub fn get_moba_name(name: &str) -> String {
    name.to_lowercase()
        .replace(" ", "")
        .replace("'", "")
        .replace(".", "")
}

pub fn get_opgg_role(role: &str) -> &'static str {
    match role.to_lowercase().as_str() {
        "middle" | "mid" => "mid",
        "top" => "top",
        "jungle" => "jungle",
        "bottom" | "adc" => "adc",
        "utility" | "support" => "support",
        _ => "mid",
    }
}

fn parse_classes(text: &str) -> HashMap<String, Vec<String>> {
    let mut classes = HashMap::new();
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with("class ") {
            if let Some(colon_idx) = line.find(':') {
                let class_name = line[6..colon_idx].trim().to_string();
                let fields_part = &line[colon_idx + 1..];
                let fields: Vec<String> = fields_part
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
                classes.insert(class_name, fields);
            }
        }
    }
    classes
}

struct Parser<'a> {
    input: &'a [char],
    pos: usize,
    classes: &'a HashMap<String, Vec<String>>,
}

impl<'a> Parser<'a> {
    fn skip_whitespace(&mut self) {
        while self.pos < self.input.len() && self.input[self.pos].is_whitespace() {
            self.pos += 1;
        }
    }

    fn peek(&mut self) -> Option<char> {
        self.skip_whitespace();
        if self.pos < self.input.len() {
            Some(self.input[self.pos])
        } else {
            None
        }
    }

    fn next_char(&mut self) -> Option<char> {
        self.skip_whitespace();
        if self.pos < self.input.len() {
            let c = self.input[self.pos];
            self.pos += 1;
            Some(c)
        } else {
            None
        }
    }

    fn parse_string(&mut self) -> Result<serde_json::Value, String> {
        let quote = self.next_char().ok_or("Unexpected EOF in string")?;
        if quote != '\'' && quote != '"' {
            return Err(format!("Expected quote, got {}", quote));
        }

        let mut s = String::new();
        while self.pos < self.input.len() {
            let c = self.input[self.pos];
            if c == quote {
                self.pos += 1;
                return Ok(serde_json::Value::String(s));
            } else if c == '\\' {
                self.pos += 1;
                if self.pos < self.input.len() {
                    let escaped = self.input[self.pos];
                    self.pos += 1;
                    match escaped {
                        'n' => s.push('\n'),
                        'r' => s.push('\r'),
                        't' => s.push('\t'),
                        _ => s.push(escaped),
                    }
                } else {
                    return Err("Trailing backslash in string".to_string());
                }
            } else {
                s.push(c);
                self.pos += 1;
            }
        }
        Err("Unterminated string".to_string())
    }

    fn parse_number(&mut self) -> Result<serde_json::Value, String> {
        let mut s = String::new();
        while let Some(c) = self.peek() {
            if c.is_ascii_digit() || c == '.' || c == '-' || c == '+' || c == 'e' || c == 'E' {
                s.push(c);
                self.pos += 1;
            } else {
                break;
            }
        }
        if s.contains('.') || s.contains('e') || s.contains('E') {
            if let Ok(n) = s.parse::<f64>() {
                Ok(serde_json::json!(n))
            } else {
                Err(format!("Invalid float: {}", s))
            }
        } else {
            if let Ok(n) = s.parse::<i64>() {
                Ok(serde_json::json!(n))
            } else if let Ok(n) = s.parse::<f64>() {
                Ok(serde_json::json!(n))
            } else {
                Err(format!("Invalid number: {}", s))
            }
        }
    }

    fn parse_list(&mut self) -> Result<serde_json::Value, String> {
        let start = self.next_char().ok_or("Unexpected EOF")?;
        if start != '[' {
            return Err(format!("Expected '[', got {}", start));
        }

        let mut list = vec![];
        loop {
            if let Some(']') = self.peek() {
                self.pos += 1;
                break;
            }
            let val = self.parse_value()?;
            list.push(val);
            if let Some(',') = self.peek() {
                self.pos += 1;
            } else if let Some(']') = self.peek() {
                // ok
            } else {
                return Err(format!("Expected ',' or ']', got {:?}", self.peek()));
            }
        }
        Ok(serde_json::Value::Array(list))
    }

    fn parse_identifier_or_class(&mut self) -> Result<serde_json::Value, String> {
        let mut name = String::new();
        while let Some(c) = self.peek() {
            if c.is_alphanumeric() || c == '_' {
                name.push(c);
                self.pos += 1;
            } else {
                break;
            }
        }

        if let Some('(') = self.peek() {
            self.pos += 1; // skip '('
            
            let empty_fields = vec![];
            let fields = self.classes.get(&name).unwrap_or(&empty_fields);
            
            let mut map = serde_json::Map::new();
            let mut positional_idx = 0;

            loop {
                if let Some(')') = self.peek() {
                    self.pos += 1;
                    break;
                }

                let saved_pos = self.pos;
                let mut is_keyword = false;
                let mut kw_name = String::new();

                self.skip_whitespace();
                let mut k_pos = self.pos;
                while k_pos < self.input.len() && (self.input[k_pos].is_alphanumeric() || self.input[k_pos] == '_') {
                    kw_name.push(self.input[k_pos]);
                    k_pos += 1;
                }
                while k_pos < self.input.len() && self.input[k_pos].is_whitespace() {
                    k_pos += 1;
                }
                if k_pos < self.input.len() && self.input[k_pos] == '=' {
                    is_keyword = true;
                    self.pos = k_pos + 1; // skip '='
                } else {
                    self.pos = saved_pos;
                }

                let val = self.parse_value()?;
                
                let key = if is_keyword {
                    kw_name
                } else {
                    if positional_idx < fields.len() {
                        let f = fields[positional_idx].clone();
                        positional_idx += 1;
                        f
                    } else {
                        let f = format!("field_{}", positional_idx);
                        positional_idx += 1;
                        f
                    }
                };

                map.insert(key, val);

                if let Some(',') = self.peek() {
                    self.pos += 1;
                } else if let Some(')') = self.peek() {
                    // ok
                } else {
                    return Err(format!("Expected ',' or ')', got {:?}", self.peek()));
                }
            }

            return Ok(serde_json::Value::Object(map));
        }

        match name.as_str() {
            "True" => Ok(serde_json::json!(true)),
            "False" => Ok(serde_json::json!(false)),
            "None" => Ok(serde_json::json!(null)),
            _ => Ok(serde_json::Value::String(name)),
        }
    }

    fn parse_value(&mut self) -> Result<serde_json::Value, String> {
        let c = self.peek().ok_or("Unexpected EOF")?;
        if c == '\'' || c == '"' {
            self.parse_string()
        } else if c == '[' {
            self.parse_list()
        } else if c.is_ascii_digit() || c == '-' {
            self.parse_number()
        } else if c.is_alphabetic() || c == '_' {
            self.parse_identifier_or_class()
        } else {
            Err(format!("Unexpected character: {}", c))
        }
    }
}

pub fn fetch_opgg_champion_stats(champion_name: &str, role: &str) -> Option<OpggChampionStats> {
    let opgg_role = get_opgg_role(role);
    let opgg_champ_key = clean_opgg_champ_name(champion_name);

    let base_url = "https://mcp-api.op.gg/mcp";
    let headers = {
        let mut h = reqwest::header::HeaderMap::new();
        h.insert(reqwest::header::CONTENT_TYPE, "application/json".parse().unwrap());
        h.insert(
            reqwest::header::USER_AGENT,
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36".parse().unwrap()
        );
        h
    };

    let rpc_call = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
            "name": "lol_get_champion_analysis",
            "arguments": {
                "game_mode": "ranked",
                "champion": opgg_champ_key,
                "position": opgg_role,
                "desired_output_fields": [
                    "champion",
                    "position",
                    "data.starter_items",
                    "data.core_items",
                    "data.boots",
                    "data.runes",
                    "data.skills",
                    "data.skill_masteries",
                    "data.summoner_spells",
                    "data.strong_counters",
                    "data.weak_counters",
                    "data.synergies.support",
                    "data.synergies.adc"
                ]
            }
        },
        "id": "1"
    });

    let client = reqwest::blocking::Client::builder()
        .default_headers(headers)
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .ok()?;

    let res = match client.post(base_url).json(&rpc_call).send() {
        Ok(r) => {
             println!("[OP.GG] RPC request for {} {} - Status: {}", champion_name, role, r.status());
             r
        },
        Err(e) => {
            println!("[OP.GG] Request Send Error for {} {}: {:?}", champion_name, role, e);
            return None;
        }
    };

    let status = res.status();
    let body_text = res.text().unwrap_or_default();

    if !status.is_success() {
        if status == reqwest::StatusCode::FORBIDDEN {
            println!("[OP.GG] ERROR: HTTP 403 Forbidden. Likely blocked by Cloudflare.");
        } else {
            println!("[OP.GG] ERROR: HTTP Status Error: {} - Body snippet: {}", status, body_text.chars().take(200).collect::<String>());
        }
        if body_text.contains("Attention Required! | Cloudflare") || body_text.contains("cf-browser-verification") {
            println!("[OP.GG] ERROR: Cloudflare block detected in error response body!");
        }
        return None;
    }

    if body_text.contains("Attention Required! | Cloudflare") || body_text.contains("cf-browser-verification") {
        println!("[OP.GG] ERROR: Cloudflare captcha/verification page detected in 200 OK body!");
        return None;
    }

    println!("[OP.GG] Successfully fetched data for {} {}. Body size: {} bytes", champion_name, role, body_text.len());

    let rpc_res = match serde_json::from_str::<serde_json::Value>(&body_text) {
        Ok(v) => v,
        Err(e) => {
            println!("[OP.GG] Response JSON Deserialization Error: {:?}", e);
            return None;
        }
    };
    if rpc_res.get("error").is_some() {
        println!("[OP.GG] RPC Error: {:?}", rpc_res.get("error"));
        return None;
    }

    let content = match rpc_res.get("result").and_then(|r| r.get("content")).and_then(|c| c.as_array()) {
        Some(c) => c,
        None => {
            println!("[OP.GG] Missing result.content in RPC response. Raw response: {:?}", rpc_res);
            return None;
        }
    };
    if content.is_empty() {
        println!("[OP.GG] Empty content list in response.");
        return None;
    }

    let text_data = match content[0].get("text").and_then(|t| t.as_str()) {
        Some(t) => t,
        None => {
            println!("[OP.GG] Content[0].text is not a string.");
            return None;
        }
    };
    let inst_start = match text_data.find("LolGetChampionAnalysis(") {
        Some(idx) => idx,
        None => {
            println!("[OP.GG] 'LolGetChampionAnalysis(' not found in content text.");
            return None;
        }
    };
    let inst_str = &text_data[inst_start..];

    // Convert instantiation string to JSON
    let classes = parse_classes(text_data);
    let chars: Vec<char> = inst_str.chars().collect();
    let mut parser = Parser {
        input: &chars,
        pos: 0,
        classes: &classes,
    };
    let val = match parser.parse_value() {
        Ok(v) => v,
        Err(e) => {
            println!("[OP.GG] custom parsing failed: {:?}", e);
            println!("[OP.GG] Instantiation text: {}", inst_str);
            return None;
        }
    };
    let data_dict = val.get("data")?;

    let mut build_data = None;
    let mut counters = vec![];

    // 1. Resolve Runes
    let r_raw = data_dict.get("runes");
    let mut runes = None;
    if let Some(r) = r_raw {
        let primary_style_id = r.get("primary_page_id").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
        let sub_style_id = r.get("secondary_page_id").and_then(|v| v.as_i64()).unwrap_or(0) as i32;

        let primary_style = DD_MANAGER.get_rune_by_id(primary_style_id);
        let sub_style = DD_MANAGER.get_rune_by_id(sub_style_id);

        let mut perks = vec![];
        if let Some(p_ids) = r.get("primary_rune_ids").and_then(|v| v.as_array()) {
            for p in p_ids {
                if let Some(id) = p.as_i64() {
                    perks.push(DD_MANAGER.get_rune_by_id(id as i32));
                }
            }
        }
        if let Some(p_ids) = r.get("secondary_rune_ids").and_then(|v| v.as_array()) {
            for p in p_ids {
                if let Some(id) = p.as_i64() {
                    perks.push(DD_MANAGER.get_rune_by_id(id as i32));
                }
            }
        }

        let mut shards = vec![];
        if let Some(s_ids) = r.get("stat_mod_ids").and_then(|v| v.as_array()) {
            for s in s_ids {
                if let Some(id) = s.as_i64() {
                    shards.push(DD_MANAGER.get_rune_by_id(id as i32));
                }
            }
        }

        runes = Some(UggRunes {
            primary_style,
            sub_style,
            perks,
            shards,
        });
    }

    if let Some(r_data) = runes {
        // 2. Resolve Starting Items
        let mut starting_items = vec![];
        if let Some(s_ids) = data_dict.get("starter_items").and_then(|s| s.get("ids")).and_then(|v| v.as_array()) {
            for id_val in s_ids {
                if let Some(id) = id_val.as_i64() {
                    starting_items.push(DD_MANAGER.get_item_by_id(id as i32));
                }
            }
        }

        // 3. Resolve Core Items & Boots
        let mut core_items = vec![];
        if let Some(c_ids) = data_dict.get("core_items").and_then(|c| c.get("ids")).and_then(|v| v.as_array()) {
            for id_val in c_ids {
                if let Some(id) = id_val.as_i64() {
                    core_items.push(DD_MANAGER.get_item_by_id(id as i32));
                }
            }
        }
        if let Some(b_ids) = data_dict.get("boots").and_then(|b| b.get("ids")).and_then(|v| v.as_array()) {
            for id_val in b_ids {
                if let Some(id) = id_val.as_i64() {
                    core_items.push(DD_MANAGER.get_item_by_id(id as i32));
                }
            }
        }

        // 4. Resolve Skills
        let skills_raw = data_dict.get("skills");
        let skill_masteries = data_dict.get("skill_masteries");
        let mut skill_priority = "Q > W > E".to_string();
        if let Some(ids) = skill_masteries.and_then(|s| s.get("ids")).and_then(|v| v.as_array()) {
            let parts: Vec<String> = ids.iter().map(|item| item.as_str().unwrap_or("").to_string()).collect();
            if !parts.is_empty() {
                skill_priority = parts.join(" > ");
            }
        }

        let mut skill_path = vec![];
        if let Some(order) = skills_raw.and_then(|s| s.get("order")).and_then(|v| v.as_array()) {
            for val in order {
                if let Some(n) = val.as_i64() {
                    skill_path.push(n);
                }
            }
        }

        // 5. Resolve Summoners
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

        if let Some(s_ids) = data_dict.get("summoner_spells").and_then(|s| s.get("ids")).and_then(|v| v.as_array()) {
            for id_val in s_ids {
                if let Some(s_id) = id_val.as_i64() {
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

        // 6. Resolve Teammate Synergies
        let mut support_synergies = vec![];
        let mut adc_synergies = vec![];
        if let Some(syn_raw) = data_dict.get("synergies") {
            if let Some(sups) = syn_raw.get("support").and_then(|v| v.as_array()) {
                for sup in sups {
                    let c_id = sup.get("synergy_champion_id").and_then(|v| v.as_i64()).map(|v| v as i32);
                    let name = sup.get("synergy_champion_name").and_then(|v| v.as_str()).map(|s| s.to_string());
                    let mut wr = sup.get("win_rate").and_then(|v| v.as_f64()).unwrap_or(0.5);
                    if wr <= 1.0 {
                        wr *= 100.0;
                    }
                    support_synergies.push(SynergyItem { champion_id: c_id, name, win_rate: wr });
                }
            }
            if let Some(adcs) = syn_raw.get("adc").and_then(|v| v.as_array()) {
                for adc in adcs {
                    let c_id = adc.get("synergy_champion_id").and_then(|v| v.as_i64()).map(|v| v as i32);
                    let name = adc.get("synergy_champion_name").and_then(|v| v.as_str()).map(|s| s.to_string());
                    let mut wr = adc.get("win_rate").and_then(|v| v.as_f64()).unwrap_or(0.5);
                    if wr <= 1.0 {
                        wr *= 100.0;
                    }
                    adc_synergies.push(SynergyItem { champion_id: c_id, name, win_rate: wr });
                }
            }
        }

        build_data = Some(OpggBuild {
            runes: r_data,
            starting_items,
            core_items,
            situational_items: vec![],
            skill_priority,
            skill_path,
            summoner_spells,
            synergies: OpggSynergies {
                support: support_synergies,
                adc: adc_synergies,
            },
        });
    }

    // 7. Resolve Counters
    if let Some(strong) = data_dict.get("strong_counters").and_then(|v| v.as_array()) {
        for sc in strong {
            let c_id = sc.get("champion_id").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            let champ_info = DD_MANAGER.get_champion_by_id(c_id);
            let mut wr = sc.get("win_rate").and_then(|v| v.as_f64()).unwrap_or(50.0);
            if wr <= 1.0 {
                wr *= 100.0;
            }
            counters.push(UggCounter {
                champion_id: c_id,
                name: champ_info.name.clone(),
                key: champ_info.key.clone(),
                image: champ_info.image.clone(),
                win_rate: wr,
                matches: sc.get("play").and_then(|v| v.as_i64()).unwrap_or(0),
                gold_adv_15: 0.0,
                xp_adv_15: 0.0,
                cs_adv_15: 0.0,
                kill_adv_15: 0.0,
                team_gold_difference_15: 0.0,
                mobafire_guide_url: format!("https://www.mobafire.com/league-of-legends/champion/{}", get_moba_name(&champ_info.name)),
                mobafire_counters_url: format!("https://www.mobafire.com/league-of-legends/champion/{}/counters", get_moba_name(&champ_info.name)),
            });
        }
    }
    if let Some(weak) = data_dict.get("weak_counters").and_then(|v| v.as_array()) {
        for wc in weak {
            let c_id = wc.get("champion_id").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            let champ_info = DD_MANAGER.get_champion_by_id(c_id);
            let mut wr = wc.get("win_rate").and_then(|v| v.as_f64()).unwrap_or(50.0);
            if wr <= 1.0 {
                wr *= 100.0;
            }
            counters.push(UggCounter {
                champion_id: c_id,
                name: champ_info.name.clone(),
                key: champ_info.key.clone(),
                image: champ_info.image.clone(),
                win_rate: wr,
                matches: wc.get("play").and_then(|v| v.as_i64()).unwrap_or(0),
                gold_adv_15: 0.0,
                xp_adv_15: 0.0,
                cs_adv_15: 0.0,
                kill_adv_15: 0.0,
                team_gold_difference_15: 0.0,
                mobafire_guide_url: format!("https://www.mobafire.com/league-of-legends/champion/{}", get_moba_name(&champ_info.name)),
                mobafire_counters_url: format!("https://www.mobafire.com/league-of-legends/champion/{}/counters", get_moba_name(&champ_info.name)),
            });
        }
    }

    counters.sort_by(|a, b| a.win_rate.partial_cmp(&b.win_rate).unwrap_or(std::cmp::Ordering::Equal));

    Some(OpggChampionStats {
        champion: champion_name.to_string(),
        role: role.to_string(),
        build: build_data,
        counters,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_opgg_fetch_stats() {
        let stats_opt = fetch_opgg_champion_stats("Ahri", "mid");
        assert!(stats_opt.is_some(), "OP.GG request should complete successfully");
        let stats = stats_opt.unwrap();
        assert_eq!(stats.champion, "Ahri");
        assert_eq!(stats.role, "mid");
        assert!(stats.build.is_some(), "Should parse OP.GG recommended build");
        assert!(!stats.counters.is_empty(), "Should parse OP.GG counters");
    }
}
