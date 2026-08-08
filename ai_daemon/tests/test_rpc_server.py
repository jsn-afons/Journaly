import unittest
from ai_daemon.api.rpc_server import handle_line

class RpcServerTests(unittest.IsolatedAsyncioTestCase):
    async def test_health_response_is_structured(self):
        response = await handle_line('{"jsonrpc":"2.0","id":1,"method":"health"}')
        self.assertEqual(response["result"], {"status": "ok", "service": "ai_daemon"})

    async def test_unknown_method_is_structured_error(self):
        response = await handle_line('{"jsonrpc":"2.0","id":1,"method":"nope"}')
        self.assertEqual(response["error"]["code"], "METHOD_NOT_FOUND")
