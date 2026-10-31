"""Typed runtime configuration.

Provider settings (endpoint, model, dimensions) come from an optional JSON file and may be
overridden by environment variables. API keys are read from the environment only and are never
accepted from the file (AGENT.md sec.32). Chat and embeddings are configured independently, so
e.g. a local Ollama embedding model can be paired with a hosted chat model.
"""
from pathlib import Path
import json
import os
from pydantic import BaseModel, Field

OPENAI_BASE_URL = "https://api.openai.com/v1"
CONFIG_FILE_NAME = "journaly.config.json"
_FILE_KEYS = {"chat_base_url", "chat_model", "embedding_base_url", "embedding_model", "embedding_dimensions", "send_embedding_dimensions", "provider_timeout_seconds"}
_ENV_KEYS = {
    "chat_base_url": "JOURNALY_CHAT_BASE_URL", "chat_model": "JOURNALY_CHAT_MODEL",
    "embedding_base_url": "JOURNALY_EMBEDDING_BASE_URL", "embedding_model": "JOURNALY_EMBEDDING_MODEL",
    "embedding_dimensions": "JOURNALY_EMBEDDING_DIMENSIONS", "send_embedding_dimensions": "JOURNALY_SEND_EMBEDDING_DIMENSIONS",
    "provider_timeout_seconds": "JOURNALY_PROVIDER_TIMEOUT_SECONDS",
}

def _legacy_key() -> str | None: return os.environ.get("JOURNALY_OPENAI_API_KEY")

class DaemonConfig(BaseModel):
    # Rust owns the journal location and exports it as JOURNALY_JOURNAL_DIR when spawning the daemon, so both layers always agree.
    journal_directory: Path = Field(default_factory=lambda: Path(os.environ.get("JOURNALY_JOURNAL_DIR") or Path.cwd() / "Journal"))
    database_path: Path = Field(default_factory=lambda: Path.cwd() / "journal_index.db")
    rpc_timeout_seconds: float = Field(default=30, gt=0, le=300)
    retrieval_limit: int = Field(default=25, gt=0, le=100)
    # Local models can take a while to load on first use, hence the generous default.
    provider_timeout_seconds: float = Field(default=120, gt=0, le=600)
    chat_base_url: str = OPENAI_BASE_URL
    chat_model: str = "gpt-4o-mini"
    chat_api_key: str | None = Field(default_factory=lambda: os.environ.get("JOURNALY_CHAT_API_KEY") or _legacy_key(), exclude=True, repr=False)
    embedding_base_url: str = OPENAI_BASE_URL
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = Field(default=1536, gt=0)
    # The `dimensions` request field is an OpenAI extension; many servers reject or ignore it. None = only send it to api.openai.com.
    send_embedding_dimensions: bool | None = None
    embedding_api_key: str | None = Field(default_factory=lambda: os.environ.get("JOURNALY_EMBEDDING_API_KEY") or _legacy_key(), exclude=True, repr=False)

    @classmethod
    def load(cls, config_file: Path | None = None) -> "DaemonConfig":
        """Defaults < config file < environment variables."""
        values: dict[str, object] = {}
        path = config_file or Path(os.environ.get("JOURNALY_CONFIG") or Path.cwd() / CONFIG_FILE_NAME)
        if path.is_file():
            data = json.loads(path.read_text())
            unknown = set(data) - _FILE_KEYS
            if unknown: raise ValueError(f"{path}: unsupported keys {sorted(unknown)} (API keys must be set via environment variables)")
            values.update(data)
        for field, variable in _ENV_KEYS.items():
            if os.environ.get(variable): values[field] = os.environ[variable]
        return cls.model_validate(values)
