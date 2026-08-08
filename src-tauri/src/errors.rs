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
    Rpc { code: String, message: String },
}

impl AppError { pub fn journal(error: std::io::Error) -> Self { Self::Journal(error.to_string()) } }

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: serde::Serializer { serializer.serialize_str(&self.to_string()) }
}
