use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummonerInfo {
    pub name: String,
    pub tag: String,
    pub puuid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChampSelectPlayer {
    pub name: String,
    pub role: String,
    pub champion_id: i32,
    pub is_locked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChampSelectState {
    pub role: String,
    pub champion: Option<serde_json::Value>,
    pub is_locked: bool,
    pub enemy_picks: Vec<serde_json::Value>,
    pub team_picks: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppState {
    pub connected: bool,
    pub phase: String,
    pub summoner: Option<SummonerInfo>,
    pub champ_select: Option<ChampSelectState>,
    pub stats: Option<serde_json::Value>,
    pub stats_opgg: Option<serde_json::Value>,
    pub tips: Option<Vec<String>>,
    pub draft_suggestions: Option<serde_json::Value>,
    pub live_game: Option<serde_json::Value>,
    pub warmup: Option<serde_json::Value>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            connected: false,
            phase: "None".to_string(),
            summoner: None,
            champ_select: None,
            stats: None,
            stats_opgg: None,
            tips: None,
            draft_suggestions: None,
            live_game: None,
            warmup: None,
        }
    }
}

pub struct AppStateContext {
    pub state: RwLock<AppState>,
    pub tx: broadcast::Sender<String>,
}

impl AppStateContext {
    pub fn new() -> Arc<Self> {
        let (tx, _) = broadcast::channel(100);
        Arc::new(Self {
            state: RwLock::new(AppState::new()),
            tx,
        })
    }

    pub async fn broadcast(&self) {
        let current = self.state.read().await;
        if let Ok(json_str) = serde_json::to_string(&*current) {
            let _ = self.tx.send(json_str);
        }
    }

    pub async fn broadcast_alert(&self, text: &str) {
        let msg = serde_json::json!({
            "type": "voice_alert",
            "text": text
        });
        if let Ok(json_str) = serde_json::to_string(&msg) {
            let _ = self.tx.send(json_str);
        }
    }
}
