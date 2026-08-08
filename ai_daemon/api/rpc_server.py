"""Line-delimited JSON-RPC 2.0 server over stdio; stdout is protocol-only."""
from __future__ import annotations
import asyncio, json, logging, sys
from typing import Any
from pydantic import ValidationError
from ai_daemon.core.models import HealthResult, RpcError, RpcRequest

logging.basicConfig(level=logging.INFO, stream=sys.stderr, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)

async def dispatch(request: RpcRequest) -> dict[str, Any]:
    if request.method == "health": return HealthResult().model_dump()
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
    except Exception:
        logger.exception("rpc request failed")
        return {"jsonrpc": "2.0", "id": request_id, "error": RpcError(code="INTERNAL_ERROR", message="Internal daemon error", retryable=True).model_dump()}

async def serve() -> None:
    for line in sys.stdin:
        if line.strip(): print(json.dumps(await handle_line(line)), flush=True)

if __name__ == "__main__": asyncio.run(serve())
