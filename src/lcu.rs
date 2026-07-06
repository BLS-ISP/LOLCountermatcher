use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use sysinfo::System;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LcuCredentials {
    pub port: u16,
    pub password: String,
    pub protocol: String,
}

pub fn read_lockfile(path: &Path) -> Option<LcuCredentials> {
    if let Ok(content) = fs::read_to_string(path) {
        let parts: Vec<&str> = content.split(':').collect();
        if parts.len() >= 5 {
            if let Ok(port) = parts[2].parse::<u16>() {
                return Some(LcuCredentials {
                    port,
                    password: parts[3].to_string(),
                    protocol: parts[4].to_string(),
                });
            }
        }
    }
    None
}

pub fn find_lcu_credentials() -> Option<LcuCredentials> {
    let mut sys = System::new();
    sys.refresh_processes();

    for (_pid, process) in sys.processes() {
        let name = process.name();
        // On Windows name can be "LeagueClient.exe" or "LeagueClient"
        if name == "LeagueClient.exe" || name == "LeagueClient" {
            let cmd = process.cmd();
            let mut port = None;
            let mut token = None;

            for arg in cmd {
                if arg.starts_with("--app-port=") {
                    port = arg.split('=').nth(1).and_then(|v| v.parse::<u16>().ok());
                } else if arg.starts_with("--remoting-auth-token=") {
                    token = arg.split('=').nth(1).map(|v| v.to_string());
                }
            }

            if let (Some(p), Some(t)) = (port, token) {
                return Some(LcuCredentials {
                    port: p,
                    password: t,
                    protocol: "https".to_string(),
                });
            }

            // Fallback: Read lockfile from executable directory
            if let Some(exe_path) = process.exe() {
                if let Some(dir) = exe_path.parent() {
                    let lockfile_path = dir.join("lockfile");
                    if lockfile_path.exists() {
                        if let Some(creds) = read_lockfile(&lockfile_path) {
                            return Some(creds);
                        }
                    }
                }
            }
        }
    }

    // Default install location fallback
    let default_lockfile = PathBuf::from(r"C:\Riot Games\League of Legends\lockfile");
    if default_lockfile.exists() {
        return read_lockfile(&default_lockfile);
    }

    None
}

pub struct LcuManager {
    pub credentials: Option<LcuCredentials>,
    pub client: Option<reqwest::blocking::Client>,
    pub base_url: String,
    pub summoner_name: String,
    pub summoner_tag: String,
    pub puuid: String,
}

impl LcuManager {
    pub fn new() -> Self {
        Self {
            credentials: None,
            client: None,
            base_url: String::new(),
            summoner_name: String::new(),
            summoner_tag: String::new(),
            puuid: String::new(),
        }
    }

    pub fn connect(&mut self) -> bool {
        self.credentials = find_lcu_credentials();
        let creds = match &self.credentials {
            Some(c) => c,
            None => {
                self.client = None;
                return false;
            }
        };

        self.base_url = format!("{}://127.0.0.1:{}", creds.protocol, creds.port);

        // Build reqwest client with disabled SSL verification (self-signed certs)
        let client = reqwest::blocking::Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(std::time::Duration::from_secs(2))
            .build();

        let client = match client {
            Ok(c) => c,
            Err(_) => {
                self.client = None;
                return false;
            }
        };

        // Test connection and fetch summoner details
        let url = format!("{}/lol-summoner/v1/current-summoner", self.base_url);
        let res = client
            .get(&url)
            .basic_auth("riot", Some(&creds.password))
            .send();

        match res {
            Ok(r) if r.status().is_success() => {
                if let Ok(val) = r.json::<serde_json::Value>() {
                    let game_name = val.get("gameName").and_then(|v| v.as_str());
                    let display_name = val.get("displayName").and_then(|v| v.as_str());
                    self.summoner_name = game_name.or(display_name).unwrap_or("Summoner").to_string();
                    self.summoner_tag = val.get("tagLine").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    self.puuid = val.get("puuid").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    self.client = Some(client);
                    true
                } else {
                    self.client = None;
                    false
                }
            }
            _ => {
                self.client = None;
                false
            }
        }
    }

    pub fn is_connected(&mut self) -> bool {
        if self.client.is_none() {
            return self.connect();
        }
        let url = format!("{}/lol-summoner/v1/current-summoner", self.base_url);
        let creds = self.credentials.as_ref().unwrap();
        let res = self.client.as_ref().unwrap()
            .get(&url)
            .basic_auth("riot", Some(&creds.password))
            .send();

        match res {
            Ok(r) if r.status().is_success() => true,
            _ => {
                self.client = None;
                false
            }
        }
    }

    pub fn get_game_phase(&mut self) -> String {
        if !self.is_connected() {
            return "None".to_string();
        }
        let url = format!("{}/lol-gameflow/v1/gameflow-phase", self.base_url);
        let creds = self.credentials.as_ref().unwrap();
        let res = self.client.as_ref().unwrap()
            .get(&url)
            .basic_auth("riot", Some(&creds.password))
            .send();

        match res {
            Ok(r) if r.status().is_success() => {
                if let Ok(phase_str) = r.json::<String>() {
                    phase_str
                } else {
                    "None".to_string()
                }
            }
            _ => "None".to_string(),
        }
    }

    pub fn get_champ_select_data(&mut self) -> Option<serde_json::Value> {
        if !self.is_connected() {
            return None;
        }
        let url = format!("{}/lol-champ-select/v1/session", self.base_url);
        let creds = self.credentials.as_ref().unwrap();
        let res = self.client.as_ref().unwrap()
            .get(&url)
            .basic_auth("riot", Some(&creds.password))
            .send();

        match res {
            Ok(r) if r.status().is_success() => r.json::<serde_json::Value>().ok(),
            _ => None,
        }
    }

    pub fn import_runes(
        &mut self,
        primary_style_id: i32,
        sub_style_id: i32,
        perk_ids: Vec<i32>,
        shard_ids: Vec<i32>,
        page_name: &str,
    ) -> serde_json::Value {
        if !self.is_connected() {
            return serde_json::json!({"success": false, "error": "League Client is not connected."});
        }
        let client = self.client.as_ref().unwrap();
        let creds = self.credentials.as_ref().unwrap();

        // 1. Fetch all perk pages
        let url_pages = format!("{}/lol-perks/v1/pages", self.base_url);
        let res = client
            .get(&url_pages)
            .basic_auth("riot", Some(&creds.password))
            .send();

        let pages = match res {
            Ok(r) if r.status().is_success() => {
                if let Ok(p) = r.json::<Vec<serde_json::Value>>() {
                    p
                } else {
                    return serde_json::json!({"success": false, "error": "Failed to parse rune pages."});
                }
            }
            _ => return serde_json::json!({"success": false, "error": "Failed to retrieve rune pages from client."}),
        };

        // Find the first editable (deletable) custom page
        let editable_page = pages.iter().find(|p| {
            p.get("isDeletable")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        });

        let page_id = match editable_page {
            Some(p) => p.get("id").and_then(|v| v.as_i64()).unwrap_or(0),
            None => {
                return serde_json::json!({
                    "success": false,
                    "error": "No editable rune page found. Please delete one premade page or create a custom page."
                });
            }
        };

        // Combine primary, secondary perks and stat shards
        let mut selected_perks = perk_ids;
        selected_perks.extend(shard_ids);
        while selected_perks.len() < 9 {
            selected_perks.push(5001); // fallback stat mod
        }
        selected_perks.truncate(9);

        let payload = serde_json::json!({
            "name": page_name,
            "primaryStyleId": primary_style_id,
            "subStyleId": sub_style_id,
            "selectedPerkIds": selected_perks
        });

        // 3. Update the page
        let url_update = format!("{}/lol-perks/v1/pages/{}", self.base_url, page_id);
        let put_res = client
            .put(&url_update)
            .basic_auth("riot", Some(&creds.password))
            .json(&payload)
            .send();

        match put_res {
            Ok(r) if r.status().is_success() => {
                // 4. Set as active page
                let url_active = format!("{}/lol-perks/v1/activepage", self.base_url);
                let _ = client
                    .put(&url_active)
                    .basic_auth("riot", Some(&creds.password))
                    .json(&page_id)
                    .send();

                serde_json::json!({"success": true, "page_name": page_name})
            }
            Ok(r) => {
                let err_text = r.text().unwrap_or_default();
                serde_json::json!({"success": false, "error": format!("Failed to update rune page: {}", err_text)})
            }
            Err(e) => serde_json::json!({"success": false, "error": e.to_string()}),
        }
    }
}
