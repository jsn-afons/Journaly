"""Typed, non-secret runtime configuration."""
from pathlib import Path
import os
from pydantic import BaseModel, Field

class DaemonConfig(BaseModel):
    # Rust owns the journal location and exports it as JOURNALY_JOURNAL_DIR when spawning the daemon, so both layers always agree.
    journal_directory: Path = Field(default_factory=lambda: Path(os.environ.get("JOURNALY_JOURNAL_DIR") or Path.cwd() / "Journal"))
    database_path: Path = Field(default_factory=lambda: Path.cwd() / "journal_index.db")
    rpc_timeout_seconds: float = Field(default=30, gt=0, le=300)
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = Field(default=1536, gt=0)
    chat_model: str = "gpt-4o-mini"
    openai_base_url: str = "https://api.openai.com/v1"
    openai_api_key: str | None = Field(default_factory=lambda: os.environ.get("JOURNALY_OPENAI_API_KEY"), exclude=True)
    retrieval_limit: int = Field(default=25, gt=0, le=100)
