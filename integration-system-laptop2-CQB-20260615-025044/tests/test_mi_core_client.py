"""Tests for mi_core_client.py — Mi-core HTTP client."""
import json
import os
import sys
import warnings
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "desktop-app"))


class TestMiCoreConfigResolution(unittest.TestCase):
    def test_mi_core_key_preferred(self):
        config = {
            "mi_core": {"enabled": True, "base_url": "http://mi-core:3456"},
            "agent_coding": {"enabled": True, "base_url": "http://old:3456"},
        }
        with patch("services.mi_core_client._load_local_config", return_value=config):
            import services.mi_core_client as m
            cfg, src = m._get_central_config()
        self.assertEqual(src, "mi_core")
        self.assertEqual(cfg["base_url"], "http://mi-core:3456")

    def test_agent_coding_fallback(self):
        config = {"agent_coding": {"enabled": True, "base_url": "http://legacy:3456"}}
        with patch("services.mi_core_client._load_local_config", return_value=config):
            import services.mi_core_client as m
            with warnings.catch_warnings(record=True) as w:
                warnings.simplefilter("always")
                cfg, src = m._get_central_config()
        self.assertEqual(src, "agent_coding")
        self.assertEqual(cfg["base_url"], "http://legacy:3456")
        self.assertTrue(any("deprecated" in str(warning.message).lower() for warning in w))

    def test_no_config_defaults(self):
        with patch("services.mi_core_client._load_local_config", return_value={}):
            import services.mi_core_client as m
            cfg = m.get_central_config()
        self.assertFalse(cfg["enabled"])
        self.assertEqual(cfg["base_url"], "http://localhost:4001")

    def test_api_key_prefers_mi_core_env(self):
        clean_env = {k: v for k, v in os.environ.items() if k not in ("MI_CORE_API_KEY", "AGENT_CODING_API_KEY")}
        clean_env["MI_CORE_API_KEY"] = "new-key"
        clean_env["AGENT_CODING_API_KEY"] = "old-key"
        with patch.dict(os.environ, clean_env, clear=True):
            import services.mi_core_client as m
            self.assertEqual(m.get_api_key(), "new-key")

    def test_api_key_falls_back_to_agent_coding_env(self):
        clean_env = {k: v for k, v in os.environ.items() if k not in ("MI_CORE_API_KEY", "AGENT_CODING_API_KEY")}
        clean_env["AGENT_CODING_API_KEY"] = "old-key"
        with patch.dict(os.environ, clean_env, clear=True):
            import services.mi_core_client as m
            self.assertEqual(m.get_api_key(), "old-key")


class TestMiCoreClientMethods(unittest.TestCase):
    def _make_client(self):
        from services.mi_core_client import MiCoreClient
        return MiCoreClient(base_url="http://test:3456", timeout=5)

    def test_ping_returns_false_on_failure(self):
        client = self._make_client()
        with patch.object(client, "_get", return_value=None):
            self.assertFalse(client.ping())

    def test_ping_returns_true_on_ok(self):
        client = self._make_client()
        with patch.object(client, "_get", return_value={"ok": True}):
            self.assertTrue(client.ping())

    def test_heartbeat_posts_to_correct_path(self):
        client = self._make_client()
        posted = []
        with patch.object(client, "_post", side_effect=lambda path, _: posted.append(path) or True):
            mock_id = MagicMock(machine_id="t1", store_code="s1", app_version="1.0")
            with patch("services.machine_identity_service.get_machine_identity", return_value=mock_id):
                client.heartbeat()
        self.assertIn("/api/qb-agent/heartbeat", posted)

    def test_headers_include_x_api_key(self):
        clean_env = {k: v for k, v in os.environ.items() if k not in ("MI_CORE_API_KEY", "AGENT_CODING_API_KEY")}
        clean_env["MI_CORE_API_KEY"] = "mi-key"
        with patch.dict(os.environ, clean_env, clear=True):
            client = self._make_client()
            mock_id = MagicMock(machine_id="t1", store_code="s1", app_version="1.0")
            with patch("services.machine_identity_service.get_machine_identity", return_value=mock_id):
                headers = client._headers()
        self.assertEqual(headers["X-API-Key"], "mi-key")

    def test_complete_command_posts_to_complete_path(self):
        client = self._make_client()
        posted = []
        with patch.object(client, "_post", side_effect=lambda path, payload: posted.append((path, payload)) or True):
            client.complete_command("cmd-123", result={"ok": True})
        self.assertEqual(posted[0][0], "/api/qb-agent/commands/cmd-123/complete")
        self.assertEqual(posted[0][1]["status"], "completed")
        self.assertEqual(posted[0][1]["result_json"], {"ok": True})

    def test_activity_log_result_includes_file_id(self):
        client = self._make_client()
        payloads = []
        with patch.object(client, "_post", side_effect=lambda _, pl: payloads.append(pl) or True):
            mock_id = MagicMock(machine_id="t1", store_code="s1", app_version="1.0")
            with patch("services.machine_identity_service.get_machine_identity", return_value=mock_id):
                client.activity_log_result("2026-06-09", file_id="bandera")
        self.assertEqual(payloads[0]["file_id"], "bandera")


if __name__ == "__main__":
    unittest.main()
