use crate::{journal::JournalService, sidecar::SidecarClient};

pub struct AppState { pub sidecar: SidecarClient, pub journal: JournalService }
