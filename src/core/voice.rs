use crate::core::state::AppStateContext;
use std::sync::Arc;

pub async fn speak(ctx: &Arc<AppStateContext>, text: &str) {
    ctx.broadcast_alert(text).await;
}
