import asyncio
import json
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest import mock

from ai_daemon.api.base import ProviderUnavailable
from ai_daemon.api.openai import OpenAICompatibleProvider
from ai_daemon.core.config import DaemonConfig


class _Server:
    """Minimal OpenAI-compatible server that records what it receives."""
    def __init__(self, dims: int = 3):
        self.requests: list[dict] = []
        self.stream_pieces = ["Hel", "lo ", "world"]
        outer = self
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                outer.requests.append({"path": self.path, "auth": self.headers.get("Authorization"), "body": body})
                if body.get("stream"):
                    events = "".join(f"data: {json.dumps({'choices': [{'delta': {'content': piece}}]})}\n\n" for piece in outer.stream_pieces) + "data: [DONE]\n\n"
                    data = events.encode()
                    self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
                    return
                if self.path == "/v1/embeddings":
                    reply = {"data": [{"embedding": [0.1] * dims} for _ in body["input"]]}
                else:
                    reply = {"choices": [{"message": {"content": "hello"}}]}
                data = json.dumps(reply).encode()
                self.send_response(200); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
            def log_message(self, *args): pass
        self.httpd = HTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_port}/v1"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
    def close(self): self.httpd.shutdown(); self.httpd.server_close()


class ProviderTests(unittest.TestCase):
    def setUp(self):
        self.server = _Server(); self.addCleanup(self.server.close)

    def _provider(self, **overrides):
        args = dict(chat_base_url=self.server.url, chat_model="local-chat", embedding_base_url=self.server.url, embedding_model="local-embed", dimensions=3)
        return OpenAICompatibleProvider(**{**args, **overrides})

    def test_local_server_needs_no_api_key_and_sends_no_auth_header(self):
        provider = self._provider()
        self.assertEqual(asyncio.run(provider.generate([{"role": "user", "content": "hi"}])), "hello")
        self.assertEqual(asyncio.run(provider.generate_embeddings(["a", "b"])), [[0.1] * 3, [0.1] * 3])
        self.assertTrue(all(r["auth"] is None for r in self.server.requests))
        self.assertEqual(self.server.requests[0]["body"]["model"], "local-chat")

    def test_dimensions_field_not_sent_to_non_openai_hosts_by_default(self):
        asyncio.run(self._provider().generate_embeddings(["a"]))
        self.assertNotIn("dimensions", self.server.requests[0]["body"])

    def test_dimensions_field_can_be_forced_on(self):
        asyncio.run(self._provider(send_dimensions=True).generate_embeddings(["a"]))
        self.assertEqual(self.server.requests[0]["body"]["dimensions"], 3)

    def test_api_key_sent_when_configured(self):
        asyncio.run(self._provider(chat_api_key="secret").generate([{"role": "user", "content": "hi"}]))
        self.assertEqual(self.server.requests[0]["auth"], "Bearer secret")

    def test_chat_and_embeddings_can_use_different_servers(self):
        other = _Server(); self.addCleanup(other.close)
        provider = self._provider(embedding_base_url=other.url)
        asyncio.run(provider.generate([{"role": "user", "content": "hi"}])); asyncio.run(provider.generate_embeddings(["a"]))
        self.assertEqual([r["path"] for r in self.server.requests], ["/v1/chat/completions"])
        self.assertEqual([r["path"] for r in other.requests], ["/v1/embeddings"])

    def test_embedding_dimension_mismatch_is_reported_not_stored(self):
        with self.assertRaises(ProviderUnavailable) as context:
            asyncio.run(self._provider(dimensions=768).generate_embeddings(["a"]))
        self.assertIn("768", str(context.exception))

    def test_openai_without_key_fails_fast(self):
        provider = self._provider(chat_base_url="https://api.openai.com/v1")
        with self.assertRaises(ProviderUnavailable): asyncio.run(provider.generate([{"role": "user", "content": "hi"}]))

    def test_unreachable_server_is_provider_unavailable(self):
        provider = self._provider(chat_base_url="http://127.0.0.1:1/v1")
        with self.assertRaises(ProviderUnavailable): asyncio.run(provider.generate([{"role": "user", "content": "hi"}]))


class ConfigLoadTests(unittest.TestCase):
    def test_file_then_env_override(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "journaly.config.json"
            path.write_text(json.dumps({"chat_base_url": "http://localhost:11434/v1", "chat_model": "from-file", "embedding_dimensions": 768}))
            with mock.patch.dict(os.environ, {"JOURNALY_CHAT_MODEL": "from-env"}):
                config = DaemonConfig.load(path)
        self.assertEqual((config.chat_base_url, config.chat_model, config.embedding_dimensions), ("http://localhost:11434/v1", "from-env", 768))

    def test_api_keys_in_file_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "journaly.config.json"
            path.write_text(json.dumps({"chat_api_key": "oops"}))
            with self.assertRaises(ValueError): DaemonConfig.load(path)

    def test_keys_never_appear_in_dumps_or_repr(self):
        with mock.patch.dict(os.environ, {"JOURNALY_CHAT_API_KEY": "topsecret"}):
            config = DaemonConfig()
        self.assertNotIn("topsecret", repr(config)); self.assertNotIn("topsecret", str(config.model_dump()))


class ErrorMessageTests(unittest.TestCase):
    def test_404_mentions_missing_model_without_leaking_body(self):
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                data = b'{"error":"model secret-journal-text not found"}'
                self.send_response(404); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
            def log_message(self, *args): pass
        httpd = HTTPServer(("127.0.0.1", 0), Handler); threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(httpd.server_close); self.addCleanup(httpd.shutdown)
        url = f"http://127.0.0.1:{httpd.server_port}/v1"
        provider = OpenAICompatibleProvider(url, "m", url, "e", 3)
        with self.assertRaises(ProviderUnavailable) as context: asyncio.run(provider.generate_embeddings(["a"]))
        self.assertIn("HTTP 404", str(context.exception)); self.assertNotIn("secret-journal-text", str(context.exception))


class SettingsScreenSupportTests(unittest.TestCase):
    def setUp(self):
        self.server = _Server(dims=5); self.addCleanup(self.server.close)

    def test_probe_reports_real_dimensions_even_when_misconfigured(self):
        provider = OpenAICompatibleProvider(self.server.url, "c", self.server.url, "e", 768)
        self.assertEqual(asyncio.run(provider.probe_embedding_dimensions()), 5)

    def test_test_provider_flags_dimension_mismatch_and_reports_chat_ok(self):
        from ai_daemon.api.diagnostics import test_provider
        provider = OpenAICompatibleProvider(self.server.url, "c", self.server.url, "e", 768)
        result = asyncio.run(test_provider(provider))
        self.assertTrue(result["chat"]["ok"])
        self.assertFalse(result["embedding"]["ok"]); self.assertEqual(result["embedding"]["detected_dimensions"], 5)
        self.assertIn("5 dimensions", result["embedding"]["error"])

    def test_test_provider_all_ok_when_dimensions_match(self):
        from ai_daemon.api.diagnostics import test_provider
        provider = OpenAICompatibleProvider(self.server.url, "c", self.server.url, "e", 5)
        result = asyncio.run(test_provider(provider))
        self.assertTrue(result["chat"]["ok"] and result["embedding"]["ok"])

    def test_test_provider_reports_unreachable_chat_without_raising(self):
        from ai_daemon.api.diagnostics import test_provider
        provider = OpenAICompatibleProvider("http://127.0.0.1:1/v1", "c", self.server.url, "e", 5)
        result = asyncio.run(test_provider(provider))
        self.assertFalse(result["chat"]["ok"]); self.assertTrue(result["embedding"]["ok"])

    def test_list_models(self):
        from ai_daemon.api.openai import list_models
        class Models(BaseHTTPRequestHandler):
            def do_GET(self):
                data = json.dumps({"data": [{"id": "b"}, {"id": "a"}]}).encode()
                self.send_response(200); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
            def log_message(self, *args): pass
        httpd = HTTPServer(("127.0.0.1", 0), Models); threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(httpd.server_close); self.addCleanup(httpd.shutdown)
        self.assertEqual(asyncio.run(list_models(f"http://127.0.0.1:{httpd.server_port}/v1", None)), ["a", "b"])

    def test_list_models_rejects_non_http_urls(self):
        from ai_daemon.api.openai import list_models
        with self.assertRaises(ProviderUnavailable): asyncio.run(list_models("file:///etc", None))


    def test_test_provider_can_check_only_embeddings(self):
        from ai_daemon.api.diagnostics import test_provider
        provider = OpenAICompatibleProvider(self.server.url, "c", self.server.url, "e", 5)
        result = asyncio.run(test_provider(provider, ("embedding",)))
        self.assertEqual(list(result), ["embedding"])
        self.assertEqual([r["path"] for r in self.server.requests], ["/v1/embeddings"])

    def test_chat_check_caps_output_length(self):
        from ai_daemon.api.diagnostics import test_provider
        provider = OpenAICompatibleProvider(self.server.url, "c", self.server.url, "e", 5)
        asyncio.run(test_provider(provider, ("chat",)))
        self.assertEqual(self.server.requests[0]["body"]["max_tokens"], 16)


    def test_test_provider_can_check_only_embeddings(self):
        from ai_daemon.api.diagnostics import test_provider
        provider = OpenAICompatibleProvider(self.server.url, "c", self.server.url, "e", 5)
        result = asyncio.run(test_provider(provider, ("embedding",)))
        self.assertEqual(list(result), ["embedding"])
        self.assertEqual([r["path"] for r in self.server.requests], ["/v1/embeddings"])

    def test_chat_check_caps_output_length(self):
        from ai_daemon.api.diagnostics import test_provider
        provider = OpenAICompatibleProvider(self.server.url, "c", self.server.url, "e", 5)
        asyncio.run(test_provider(provider, ("chat",)))
        self.assertEqual(self.server.requests[0]["body"]["max_tokens"], 16)


class StreamingTests(unittest.TestCase):
    def setUp(self):
        self.server = _Server(); self.addCleanup(self.server.close)

    async def _collect(self, provider):
        return [piece async for piece in provider.generate_stream([{"role": "user", "content": "hi"}])]

    def test_parses_server_sent_events(self):
        provider = OpenAICompatibleProvider(self.server.url, "c", self.server.url, "e", 3)
        self.assertEqual(asyncio.run(self._collect(provider)), ["Hel", "lo ", "world"])
        self.assertTrue(self.server.requests[0]["body"]["stream"])

    def test_unreachable_stream_is_provider_unavailable(self):
        provider = OpenAICompatibleProvider("http://127.0.0.1:1/v1", "c", self.server.url, "e", 3)
        with self.assertRaises(ProviderUnavailable): asyncio.run(self._collect(provider))
