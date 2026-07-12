use std::fs;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use crate::providers::cache::get_settings_file;

lazy_static::lazy_static! {
    pub static ref SETTINGS: Mutex<Settings> = Mutex::new(Settings::default());
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

pub fn load_settings() {
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

pub fn save_settings(settings: &Settings) {
    let path = get_settings_file();
    if let Ok(content) = serde_json::to_string_pretty(settings) {
        fs::write(&path, content).ok();
        *SETTINGS.lock().unwrap() = settings.clone();
    }
}
