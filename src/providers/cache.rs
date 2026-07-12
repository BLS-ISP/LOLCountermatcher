use std::collections::HashMap;
use std::sync::Mutex;
use std::fs;
use std::path::PathBuf;
use crate::providers::ugg;
use crate::providers::opgg;

lazy_static::lazy_static! {
    pub static ref STATS_CACHE: Mutex<HashMap<(String, String), serde_json::Value>> = Mutex::new(HashMap::new());
    pub static ref OPGG_CACHE: Mutex<HashMap<(String, String), serde_json::Value>> = Mutex::new(HashMap::new());
}

pub fn get_exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn get_cache_dir() -> PathBuf {
    let dir = get_exe_dir().join("cache");
    fs::create_dir_all(&dir).ok();
    dir
}

pub fn get_settings_file() -> PathBuf {
    get_exe_dir().join("settings.json")
}

pub fn get_notes_file() -> PathBuf {
    get_exe_dir().join("matchup_notes.json")
}

pub fn get_custom_builds_file() -> PathBuf {
    get_exe_dir().join("custom_builds.json")
}

pub fn get_tips_file() -> PathBuf {
    get_exe_dir().join("tips.json")
}

pub fn get_match_history_file() -> PathBuf {
    get_cache_dir().join("match_history_records.json")
}

pub fn get_cached_stats(champion_name: &str, role: &str) -> Option<serde_json::Value> {
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

    // Stale disk-cache fallback: if live fetch failed, use stale cache if available
    if filename.exists() {
        if let Ok(content) = fs::read_to_string(&filename) {
            if let Ok(stats) = serde_json::from_str::<serde_json::Value>(&content) {
                if stats.get("build").is_some() {
                    println!("[Cache] Using stale UGG disk cache for {} {}", champion_name, role);
                    STATS_CACHE.lock().unwrap().insert(key, stats.clone());
                    return Some(stats);
                }
            }
        }
    }

    None
}

pub fn get_cached_opgg_stats(champion_name: &str, role: &str) -> Option<serde_json::Value> {
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

    // Stale disk-cache fallback: if live fetch failed, use stale cache if available
    if filename.exists() {
        if let Ok(content) = fs::read_to_string(&filename) {
            if let Ok(stats) = serde_json::from_str::<serde_json::Value>(&content) {
                if stats.get("build").is_some() {
                    println!("[Cache] Using stale OPGG disk cache for {} {}", champion_name, role);
                    OPGG_CACHE.lock().unwrap().insert(key, stats.clone());
                    return Some(stats);
                }
            }
        }
    }

    None
}

pub fn get_cached_stats_only_disk(champion_name: &str, role: &str) -> Option<serde_json::Value> {
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

pub fn get_cached_opgg_stats_only_disk(champion_name: &str, role: &str) -> Option<serde_json::Value> {
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
