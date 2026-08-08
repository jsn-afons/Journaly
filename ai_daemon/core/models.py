from typing import Literal
from pydantic import BaseModel

class RpcRequest(BaseModel):
    jsonrpc: Literal["2.0"]
    id: int | str
    method: str

class HealthResult(BaseModel):
    status: Literal["ok"] = "ok"
    service: Literal["ai_daemon"] = "ai_daemon"

class RpcError(BaseModel):
    code: str
    message: str
    retryable: bool = False
