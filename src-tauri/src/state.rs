use crate::{embedder::Embedder, journal::JournalService, sidecar::SidecarClient};

pub struct AppState { pub sidecar: SidecarClient, pub journal: JournalService, pub embedder: Embedder }
