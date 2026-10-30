use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("journal operation failed: {0}")]
    Journal(String),
    #[error("path is outside the configured Journal directory")]
    PathOutsideJournal,
    #[error("invalid journal frontmatter: {0}")]
    InvalidFrontmatter(String),
    #[error("invalid entry title: {0}")]
    InvalidTitle(String),
    #[error("the file changed on disk before local edits were saved")]
    Conflict,
    #[error("AI sidecar is unavailable: {0}")]
    SidecarUnavailable(String),
    #[error("AI sidecar returned an invalid response: {0}")]
    InvalidResponse(String),
    #[error("AI sidecar error {code}: {message}")]
    Rpc { code: String, message: String, retryable: bool },
}

impl AppError { pub fn journal(error: std::io::Error) -> Self { Self::Journal(error.to_string()) } }

/// Errors reach the frontend as `{code, message, retryable}` so the UI never has to parse human-readable strings (AGENT.md sec.39).
#[derive(serde::Serialize)]
struct WireError { code: String, message: String, retryable: bool }

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: serde::Serializer {
        let wire = match self {
            AppError::Rpc { code, message, retryable } => WireError { code: code.clone(), message: message.clone(), retryable: *retryable },
            AppError::Conflict => WireError { code: "CONFLICT".into(), message: self.to_string(), retryable: false },
            AppError::SidecarUnavailable(_) => WireError { code: "SIDECAR_UNAVAILABLE".into(), message: self.to_string(), retryable: true },
            other => WireError { code: "JOURNAL_ERROR".into(), message: other.to_string(), retryable: false },
        };
        wire.serialize(serializer)
    }
}
