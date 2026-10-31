"""Line-delimited JSON-RPC 2.0 server over stdio; stdout is protocol-only."""
from __future__ import annotations
import asyncio, json, logging, sys
from typing import Any
from pydantic import ValidationError
from ai_daemon.core.models import HealthResult, RpcError, RpcRequest
from ai_daemon.core.config import DaemonConfig
from ai_daemon.core.database import JournalDatabase
from ai_daemon.indexer.pipeline import JournalIndexer
from ai_daemon.api.base import ProviderUnavailable
from ai_daemon.api.diagnostics import test_provider
from ai_daemon.api.openai import OpenAICompatibleProvider, list_models
from ai_daemon.retrieval.service import RetrievalService, RetrievalUnavailable

logging.basicConfig(level=logging.INFO, stream=sys.stderr, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)

config = DaemonConfig.load()
provider = OpenAICompatibleProvider.from_config(config)
database = JournalDatabase(config.database_path, config.embedding_model, config.embedding_dimensions)
indexer = JournalIndexer(config.journal_directory, database, provider, config.embedding_model, config.embedding_dimensions)
retrieval = RetrievalService(database, provider, provider, config.retrieval_limit)

def emit(method: str, params: dict[str, Any]) -> None:
    """JSON-RPC notification (no id). Sent before the final response of a streaming request."""
    print(json.dumps({"jsonrpc": "2.0", "method": method, "params": params}), flush=True)

async def dispatch(request: RpcRequest) -> dict[str, Any]:
    if request.method == "health": return HealthResult().model_dump()
    if request.method == "index_file": return indexer.index_file(str(request.params["path"]))
    if request.method == "remove_file": return indexer.remove_file(str(request.params["path"]))
    if request.method == "rebuild_index": return indexer.rebuild()
    if request.method == "search_keyword": return {"results": indexer.search_keyword(str(request.params["query"]))}
    if request.method == "get_index_status": return {"status": "ready", "database": str(config.database_path)}
    if request.method == "retry_embeddings": return await indexer.retry_embeddings()
    if request.method == "search_semantic": return await retrieval.search_semantic(str(request.params["query"]))
    if request.method == "search_hybrid": return await retrieval.search_hybrid(str(request.params["query"]))
    if request.method == "test_provider": return await test_provider(provider, tuple(str(p) for p in request.params.get("parts", ["chat", "embedding"])))
    if request.method == "list_models": return {"models": await list_models(str(request.params["base_url"]), request.params.get("api_key") or None)}
    if request.method == "chat":
        on_delta = (lambda text: emit("chat_delta", {"request_id": request.id, "text": text})) if request.params.get("stream") else None
        return await retrieval.chat(str(request.params["query"]), on_delta, request.params.get("history"))
    raise ValueError(f"unknown method: {request.method}")

async def handle_line(line: str) -> dict[str, Any]:
    request_id: int | str | None = None
    try:
        raw = json.loads(line)
        request_id = raw.get("id") if isinstance(raw, dict) else None
        request = RpcRequest.model_validate(raw)
        return {"jsonrpc": "2.0", "id": request.id, "result": await dispatch(request)}
    except ValidationError as error:
        return {"jsonrpc": "2.0", "id": request_id, "error": RpcError(code="INVALID_REQUEST", message=str(error)).model_dump()}
    except ValueError as error:
        return {"jsonrpc": "2.0", "id": request_id, "error": RpcError(code="METHOD_NOT_FOUND", message=str(error)).model_dump()}
    except RetrievalUnavailable as error:
        return {"jsonrpc": "2.0", "id": request_id, "error": RpcError(code=error.code, message=str(error), retryable=error.retryable).model_dump()}
    except ProviderUnavailable as error:
        return {"jsonrpc": "2.0", "id": request_id, "error": RpcError(code="PROVIDER_UNAVAILABLE", message=str(error), retryable=True).model_dump()}
    except Exception:
        logger.exception("rpc request failed")
        return {"jsonrpc": "2.0", "id": request_id, "error": RpcError(code="INTERNAL_ERROR", message="Internal daemon error", retryable=True).model_dump()}

async def serve() -> None:
    for line in sys.stdin:
        if line.strip(): print(json.dumps(await handle_line(line)), flush=True)

if __name__ == "__main__": asyncio.run(serve())
