use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Champion {
    pub id: i32,
    pub key: String,
    pub name: String,
    pub title: String,
    pub image: String,
    pub tags: Vec<String>,
    pub stats_info: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Item {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub plaintext: Option<String>,
    pub image: String,
    pub gold_total: i32,
    pub stats: HashMap<String, f64>,
    pub tags: Vec<String>,
    pub maps: HashMap<String, bool>,
    pub purchasable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rune {
    pub id: i32,
    pub name: String,
    pub key: Option<String>,
    pub icon: String,
    pub style_id: Option<i32>,
    pub style_name: Option<String>,
}

pub struct DataDragonManager {
    pub version: String,
    pub champions: HashMap<i32, Champion>,
    pub champions_by_key: HashMap<String, Champion>,
    pub items: HashMap<String, Item>,
    pub runes: HashMap<i32, Rune>,
}

impl DataDragonManager {
    pub fn new() -> Self {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."));
        let cache_dir = exe_dir.join("cache");
        fs::create_dir_all(&cache_dir).ok();

        let version = Self::fetch_latest_version(&cache_dir);
        let mut manager = Self {
            version: version.clone(),
            champions: HashMap::new(),
            champions_by_key: HashMap::new(),
            items: HashMap::new(),
            runes: HashMap::new(),
        };

        manager.cleanup_old_cache(&cache_dir);
        manager.load_data(&cache_dir);
        manager
    }

    fn fetch_latest_version(cache_dir: &Path) -> String {
        let version_file = cache_dir.join("version.json");
        let fallback = "14.13.1".to_string();

        let mut cached_fallback = fallback.clone();
        if version_file.exists() {
            if let Ok(content) = fs::read_to_string(&version_file) {
                if let Ok(versions) = serde_json::from_str::<Vec<String>>(&content) {
                    if !versions.is_empty() {
                        cached_fallback = versions[0].clone();
                    }
                }
            }
        }

        // Try downloading fresh versions list
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build();

        if let Ok(client) = client {
            if let Ok(res) = client.get("https://ddragon.leagueoflegends.com/api/versions.json").send() {
                if res.status().is_success() {
                    if let Ok(text_string) = res.text() {
                        if let Ok(versions) = serde_json::from_str::<Vec<String>>(&text_string) {
                            if !versions.is_empty() {
                                fs::write(&version_file, &text_string).ok();
                                return versions[0].clone();
                            }
                        }
                    }
                }
            }
        }

        cached_fallback
    }

    fn cleanup_old_cache(&self, cache_dir: &Path) {
        if let Ok(entries) = fs::read_dir(cache_dir) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type() {
                    if file_type.is_file() {
                        let name = entry.file_name().to_string_lossy().into_owned();
                        if name.ends_with(".json") && name != "version.json" && !name.contains(&self.version) && !name.starts_with("ugg_") && !name.starts_with("opgg_") && !name.starts_with("match_history") {
                            fs::remove_file(entry.path()).ok();
                        }
                    }
                }
            }
        }
    }

    fn download_if_missing(&self, url: &str, file_path: &Path) {
        if !file_path.exists() {
            println!("[DDragon] Cache missing. Downloading: {}", url);
            let client = reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(15))
                .build();
            if let Ok(client) = client {
                if let Ok(res) = client.get(url).send() {
                    if res.status().is_success() {
                        if let Ok(content) = res.bytes() {
                            fs::write(file_path, content).ok();
                        }
                    }
                }
            }
        }
    }

    fn load_data(&mut self, cache_dir: &Path) {
        // 1. Champions
        let champ_file = cache_dir.join(format!("champion_{}.json", self.version));
        let champ_url = format!(
            "https://ddragon.leagueoflegends.com/cdn/{}/data/en_US/champion.json",
            self.version
        );
        self.download_if_missing(&champ_url, &champ_file);

        if let Ok(content) = fs::read_to_string(&champ_file) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(champ_data) = val.get("data").and_then(|d| d.as_object()) {
                    for (c_key, c_info) in champ_data {
                        let c_id_str = c_info.get("key").and_then(|k| k.as_str()).unwrap_or("0");
                        let c_id = c_id_str.parse::<i32>().unwrap_or(0);
                        let info = Champion {
                            id: c_id,
                            key: c_info.get("id").and_then(|v| v.as_str()).unwrap_or(c_key).to_string(),
                            name: c_info.get("name").and_then(|v| v.as_str()).unwrap_or(c_key).to_string(),
                            title: c_info.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            image: format!(
                                "https://ddragon.leagueoflegends.com/cdn/{}/img/champion/{}",
                                self.version,
                                c_info.get("image").and_then(|img| img.get("full")).and_then(|v| v.as_str()).unwrap_or("")
                            ),
                            tags: c_info.get("tags").and_then(|t| t.as_array()).map(|arr| {
                                arr.iter().map(|item| item.as_str().unwrap_or("").to_string()).collect()
                            }).unwrap_or_default(),
                            stats_info: c_info.get("info").cloned().unwrap_or(serde_json::Value::Null),
                        };
                        self.champions.insert(c_id, info.clone());
                        self.champions_by_key.insert(info.key.to_lowercase(), info.clone());
                        self.champions_by_key.insert(info.name.to_lowercase().replace(" ", ""), info);
                    }
                }
            }
        }

        // 2. Items
        let item_file = cache_dir.join(format!("item_{}.json", self.version));
        let item_url = format!(
            "https://ddragon.leagueoflegends.com/cdn/{}/data/en_US/item.json",
            self.version
        );
        self.download_if_missing(&item_url, &item_file);

        if let Ok(content) = fs::read_to_string(&item_file) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(item_data) = val.get("data").and_then(|d| d.as_object()) {
                    for (item_id, item_info) in item_data {
                        let gold_total = item_info
                            .get("gold")
                            .and_then(|g| g.get("total"))
                            .and_then(|v| v.as_i64())
                            .unwrap_or(0) as i32;

                        let mut stats_map = HashMap::new();
                        if let Some(stats_obj) = item_info.get("stats").and_then(|v| v.as_object()) {
                            for (stat_name, stat_val) in stats_obj {
                                if let Some(val) = stat_val.as_f64() {
                                    stats_map.insert(stat_name.clone(), val);
                                }
                            }
                        }

                        let tags_list = item_info.get("tags")
                            .and_then(|t| t.as_array())
                            .map(|arr| arr.iter().map(|v| v.as_str().unwrap_or("").to_string()).collect())
                            .unwrap_or_default();

                        let mut maps_map = HashMap::new();
                        if let Some(maps_obj) = item_info.get("maps").and_then(|v| v.as_object()) {
                            for (map_id, map_val) in maps_obj {
                                if let Some(val) = map_val.as_bool() {
                                    maps_map.insert(map_id.clone(), val);
                                }
                            }
                        }

                        let purchasable = item_info.get("gold")
                            .and_then(|g| g.get("purchasable"))
                            .and_then(|v| v.as_bool())
                            .unwrap_or(true);

                        let item = Item {
                            id: item_id.clone(),
                            name: item_info.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            description: item_info.get("description").and_then(|v| v.as_str()).map(|s| s.to_string()),
                            plaintext: item_info.get("plaintext").and_then(|v| v.as_str()).map(|s| s.to_string()),
                            image: format!(
                                "https://ddragon.leagueoflegends.com/cdn/{}/img/item/{}.png",
                                self.version, item_id
                            ),
                            gold_total,
                            stats: stats_map,
                            tags: tags_list,
                            maps: maps_map,
                            purchasable,
                        };
                        self.items.insert(item_id.clone(), item);
                    }
                }
            }
        }

        // 3. Runes (Runes Reforged)
        let runes_file = cache_dir.join(format!("runes_{}.json", self.version));
        let runes_url = format!(
            "https://ddragon.leagueoflegends.com/cdn/{}/data/en_US/runesReforged.json",
            self.version
        );
        self.download_if_missing(&runes_url, &runes_file);

        if let Ok(content) = fs::read_to_string(&runes_file) {
            if let Ok(styles) = serde_json::from_str::<Vec<serde_json::Value>>(&content) {
                for style in styles {
                    let style_id = style.get("id").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
                    let style_name = style.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let style_icon = style.get("icon").and_then(|v| v.as_str()).unwrap_or("").to_string();

                    let style_info = Rune {
                        id: style_id,
                        name: style_name.clone(),
                        key: style.get("key").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        icon: format!("https://ddragon.leagueoflegends.com/cdn/img/{}", style_icon),
                        style_id: None,
                        style_name: None,
                    };
                    self.runes.insert(style_id, style_info);

                    if let Some(slots) = style.get("slots").and_then(|s| s.as_array()) {
                        for slot in slots {
                            if let Some(runes) = slot.get("runes").and_then(|r| r.as_array()) {
                                for rune in runes {
                                    let r_id = rune.get("id").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
                                    let r_name = rune.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                    let r_icon = rune.get("icon").and_then(|v| v.as_str()).unwrap_or("").to_string();

                                    let r_info = Rune {
                                        id: r_id,
                                        name: r_name,
                                        key: rune.get("key").and_then(|v| v.as_str()).map(|s| s.to_string()),
                                        icon: format!("https://ddragon.leagueoflegends.com/cdn/img/{}", r_icon),
                                        style_id: Some(style_id),
                                        style_name: Some(style_name.clone()),
                                    };
                                    self.runes.insert(r_id, r_info);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    pub fn get_champion_by_id(&self, champ_id: i32) -> Champion {
        self.champions.get(&champ_id).cloned().unwrap_or_else(|| Champion {
            id: champ_id,
            key: "Unknown".to_string(),
            name: format!("Champion {}", champ_id),
            title: "".to_string(),
            image: "".to_string(),
            tags: vec![],
            stats_info: serde_json::Value::Null,
        })
    }

    pub fn get_champion_by_name(&self, name: &str) -> Option<Champion> {
        let mut normalized = name.to_lowercase().replace(" ", "").replace("'", "").replace(".", "");
        
        // Manual mapping overrides for Riot API name vs Data Dragon key
        if normalized == "wukong" {
            normalized = "monkeyking".to_string();
        }

        if let Some(champ) = self.champions_by_key.get(&normalized) {
            return Some(champ.clone());
        }

        // Soft match fallback
        for (key, champ) in &self.champions_by_key {
            if normalized.contains(key) || key.contains(&normalized) {
                return Some(champ.clone());
            }
        }
        None
    }

    #[allow(dead_code)]
    pub fn get_champion_damage_profile(&self, champ_name: &str) -> (String, f64) {
        let champ = match self.get_champion_by_name(champ_name) {
            Some(c) => c,
            None => return ("AD".to_string(), 0.5),
        };

        let tags = &champ.tags;
        let stats_info = &champ.stats_info;

        let magic = stats_info.get("magic").and_then(|v| v.as_f64()).unwrap_or(1.0);
        let attack = stats_info.get("attack").and_then(|v| v.as_f64()).unwrap_or(1.0);

        let mut profile;
        let mut confidence;

        if magic > attack {
            profile = "AP".to_string();
            confidence = (0.5 + (magic - attack) * 0.1).min(0.95);
        } else {
            profile = "AD".to_string();
            confidence = (0.5 + (attack - magic) * 0.1).min(0.95);
        }

        if tags.iter().any(|t| t == "Mage" || t == "Spellcaster") {
            profile = "AP".to_string();
            confidence = confidence.max(0.85);
        } else if tags.iter().any(|t| t == "Marksman") {
            profile = "AD".to_string();
            confidence = confidence.max(0.90);
        }

        let overrides: HashMap<&str, (&str, f64)> = [
            ("ezreal", ("AD", 0.7)),
            ("corki", ("AP", 0.85)),
            ("katarina", ("AP", 0.75)),
            ("akali", ("AP", 0.8)),
            ("varus", ("AD", 0.75)),
            ("kayle", ("AP", 0.75)),
            ("shaco", ("AD", 0.7)),
            ("twitch", ("AD", 0.8)),
            ("singed", ("AP", 0.9)),
            ("mordekaiser", ("AP", 0.9)),
        ]
        .iter()
        .cloned()
        .collect();

        let lookup_name = champ_name.to_lowercase().replace(" ", "").replace("'", "");
        if let Some(&(prof, conf)) = overrides.get(lookup_name.as_str()) {
            return (prof.to_string(), conf);
        }

        (profile, confidence)
    }

    pub fn get_item_by_id(&self, item_id: i32) -> Item {
        let item_id_str = item_id.to_string();
        self.items.get(&item_id_str).cloned().unwrap_or_else(|| Item {
            id: item_id_str,
            name: format!("Item {}", item_id),
            description: None,
            plaintext: None,
            image: "".to_string(),
            gold_total: 0,
            stats: HashMap::new(),
            tags: vec![],
            maps: HashMap::new(),
            purchasable: false,
        })
    }

    pub fn get_rune_by_id(&self, rune_id: i32) -> Rune {
        let shard_mappings: HashMap<i32, (&str, &str)> = [
            (5001, ("Health Scaling", "healthscaling")),
            (5002, ("Armor", "armor")),
            (5003, ("Magic Resist", "magicres")),
            (5005, ("Attack Speed", "attackspeed")),
            (5007, ("Ability Haste", "cdrscaling")),
            (5008, ("Adaptive Force", "adaptiveforce")),
            (5010, ("Movement Speed", "movementspeed")),
            (5011, ("Health Flat", "healthplus")),
            (5013, ("Tenacity and Slow Resist", "tenacity")),
        ]
        .iter()
        .cloned()
        .collect();

        if let Some(&(name, filename)) = shard_mappings.get(&rune_id) {
            return Rune {
                id: rune_id,
                name: name.to_string(),
                key: None,
                icon: format!(
                    "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perk-images/statmods/statmods{}icon.png",
                    filename
                ),
                style_id: None,
                style_name: None,
            };
        }

        self.runes.get(&rune_id).cloned().unwrap_or_else(|| Rune {
            id: rune_id,
            name: format!("Perk {}", rune_id),
            key: None,
            icon: "".to_string(),
            style_id: None,
            style_name: None,
        })
    }
}

lazy_static::lazy_static! {
    pub static ref DD_MANAGER: DataDragonManager = DataDragonManager::new();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ddragon_version() {
        assert!(!DD_MANAGER.version.is_empty(), "DataDragon version should be loaded");
    }

    #[test]
    fn test_ddragon_get_champion() {
        let champ = DD_MANAGER.get_champion_by_name("Ahri");
        assert!(champ.is_some(), "Should find Ahri by name");
        let info = champ.unwrap();
        assert_eq!(info.id, 103);
        assert_eq!(info.key, "Ahri");
    }

    #[test]
    fn test_ddragon_get_item() {
        let item = DD_MANAGER.get_item_by_id(3158); // Ionian Boots
        assert_eq!(item.name, "Ionian Boots of Lucidity");
    }
}
