"""Typed, non-secret runtime configuration."""
from pathlib import Path
from pydantic import BaseModel, Field

class DaemonConfig(BaseModel):
    journal_directory: Path = Field(default_factory=lambda: Path.cwd() / "Journal")
    database_path: Path = Field(default_factory=lambda: Path.cwd() / "journal_index.db")
    rpc_timeout_seconds: float = Field(default=30, gt=0, le=300)
