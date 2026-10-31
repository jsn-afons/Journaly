"""Provider connectivity check behind the Settings screen's "Test" button."""
from __future__ import annotations
import asyncio
import time
from ai_daemon.api.base import ProviderUnavailable
from ai_daemon.api.openai import OpenAICompatibleProvider


async def _timed(operation):
    started = time.monotonic()
    try: value = await operation()
    except ProviderUnavailable as error: return {"ok": False, "error": str(error), "seconds": time.monotonic() - started}, None
    return {"ok": True, "seconds": time.monotonic() - started}, value


async def test_provider(provider: OpenAICompatibleProvider, parts: tuple[str, ...] = ("chat", "embedding")) -> dict[str, object]:
    """One tiny real request per requested endpoint. Reports the embedding size the model actually returns so the UI can fix a wrong setting."""
    async def chat() -> dict[str, object]:
        # Capped output: this only proves the endpoint and model respond, and keeps slow local models from generating at length.
        result, _ = await _timed(lambda: provider.generate([{"role": "user", "content": "Reply with the single word: ok"}], max_tokens=16))
        result["model"] = provider.chat_model
        return result

    async def embedding() -> dict[str, object]:
        result, detected = await _timed(provider.probe_embedding_dimensions)
        result.update(model=provider.embedding_model, configured_dimensions=provider.dimensions, detected_dimensions=detected)
        if result["ok"] and detected != provider.dimensions:
            result["ok"] = False
            result["error"] = f"Model returns {detected} dimensions but {provider.dimensions} are configured"
        return result

    jobs = {name: job for name, job in {"chat": chat, "embedding": embedding}.items() if name in parts}
    outcomes = await asyncio.gather(*(job() for job in jobs.values()))
    return dict(zip(jobs, outcomes))
