"""Entry point for the bundled AI service (see scripts/build_daemon.sh). Same as `python -m ai_daemon.api.rpc_server`."""
import asyncio

from ai_daemon.api.rpc_server import serve

if __name__ == "__main__":
    asyncio.run(serve())
