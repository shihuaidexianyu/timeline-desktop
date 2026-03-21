//! Shared runtime state for open segments and global application dependencies.

use crate::{config::AppConfig, db::AgentStore};
use std::sync::Arc;
use time::{OffsetDateTime, UtcOffset};
use tokio::sync::Mutex;

#[derive(Debug, Default)]
pub struct RuntimeState {
    pub current_focus: Option<OpenFocusSegment>,
    pub current_presence: Option<OpenPresenceSegment>,
    pub current_browser: Option<OpenBrowserSegment>,
}

#[derive(Debug, Clone)]
pub struct OpenFocusSegment {
    pub id: i64,
    pub fingerprint: String,
    pub is_browser: bool,
}

#[derive(Debug, Clone)]
pub struct OpenPresenceSegment {
    pub id: i64,
    pub state: common::PresenceState,
}

#[derive(Debug, Clone)]
pub struct OpenBrowserSegment {
    pub id: i64,
    pub domain: String,
    pub browser_window_id: i64,
    pub tab_id: i64,
}

pub struct AgentStateInner {
    pub config: AppConfig,
    pub store: AgentStore,
    pub started_at: OffsetDateTime,
    pub timezone: UtcOffset,
    pub runtime: Mutex<RuntimeState>,
}

#[derive(Clone)]
pub struct AgentState {
    inner: Arc<AgentStateInner>,
}

impl AgentState {
    pub fn new(
        config: AppConfig,
        store: AgentStore,
        started_at: OffsetDateTime,
        timezone: UtcOffset,
    ) -> Self {
        Self {
            inner: Arc::new(AgentStateInner {
                config,
                store,
                started_at,
                timezone,
                runtime: Mutex::new(RuntimeState::default()),
            }),
        }
    }

    pub fn config(&self) -> &AppConfig {
        &self.inner.config
    }

    pub fn store(&self) -> &AgentStore {
        &self.inner.store
    }

    pub fn started_at(&self) -> OffsetDateTime {
        self.inner.started_at
    }

    pub fn timezone(&self) -> UtcOffset {
        self.inner.timezone
    }

    pub async fn runtime(&self) -> tokio::sync::MutexGuard<'_, RuntimeState> {
        self.inner.runtime.lock().await
    }
}
