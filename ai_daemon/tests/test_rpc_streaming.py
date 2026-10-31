"""End-to-end JSON-RPC streaming: the real daemon process against a mock OpenAI-compatible SSE server."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from ai_daemon.tests.test_provider import _Server

REPO_ROOT = Path(__file__).resolve().parents[2]


class RpcStreamingTests(unittest.TestCase):
    def test_chat_stream_sends_deltas_before_final_response(self):
        server = _Server(); self.addCleanup(server.close)
        server.stream_pieces = ["You ", "wanted a ", "restaurant."]
        with tempfile.TemporaryDirectory() as directory:
            journal = Path(directory) / "Journal" / "2026" / "01"; journal.mkdir(parents=True)
            (journal / "Idea.md").write_text("# Business\nI want to start a restaurant.\n")
            env = {k: v for k, v in os.environ.items() if not k.startswith("JOURNALY_")}
            env.update(PYTHONPATH=str(REPO_ROOT), JOURNALY_JOURNAL_DIR=str(Path(directory) / "Journal"), JOURNALY_CHAT_BASE_URL=server.url, JOURNALY_EMBEDDING_BASE_URL="http://127.0.0.1:1/v1")
            requests = [
                {"jsonrpc": "2.0", "id": 1, "method": "rebuild_index", "params": {}},
                {"jsonrpc": "2.0", "id": 2, "method": "chat", "params": {"query": "restaurant", "stream": True}},
            ]
            output = subprocess.run([sys.executable, "-m", "ai_daemon.api.rpc_server"], input="".join(json.dumps(r) + "\n" for r in requests),
                                    cwd=directory, env=env, capture_output=True, text=True, timeout=60).stdout
        messages = [json.loads(line) for line in output.splitlines()]
        chat = messages[1:]
        deltas = [m for m in chat if m.get("method") == "chat_delta"]
        self.assertEqual([d["params"]["text"] for d in deltas], ["You ", "wanted a ", "restaurant."])
        self.assertTrue(all(d["params"]["request_id"] == 2 and "id" not in d for d in deltas))
        self.assertEqual(chat[-1]["id"], 2)
        self.assertEqual(chat[-1]["result"]["answer"], "You wanted a restaurant.")
