"""Typed, non-secret runtime configuration."""
from pathlib import Path
import os
from pydantic import BaseModel, Field

class DaemonConfig(BaseModel):
    journal_directory: Path = Field(default_factory=lambda: Path.cwd() / "Journal")
    database_path: Path = Field(default_factory=lambda: Path.cwd() / "journal_index.db")
    rpc_timeout_seconds: float = Field(default=30, gt=0, le=300)
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = Field(default=1536, gt=0)
    chat_model: str = "gpt-4o-mini"
    openai_base_url: str = "https://api.openai.com/v1"
    openai_api_key: str | None = Field(default_factory=lambda: os.environ.get("JOURNALY_OPENAI_API_KEY"), exclude=True)
    retrieval_limit: int = Field(default=25, gt=0, le=100)
