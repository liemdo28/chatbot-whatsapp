"""
test_mi_core_connection.py
============================
Tests Mi-core connection: config loading, heartbeat payload,
remote command structure. Does NOT require a live server.
"""
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "desktop-app"))


class TestMiCoreConfigMapping(unittest.TestCase):
    """Old agent_coding config maps correctly to mi_core."""

    def test_agent_coding_config_still_maps(self):
        config = {"agent_coding": {"enabled": True, "base_url": "http://legacy:3456"}}
        with patch("services.machine_identity_service._load_local_config", return_value=config):
            import services.machine_identity_service as svc
            cfg = svc.get_agent_coding_config()
        self.assertEqual(cfg["base_url"], "http://legacy:3456")
        self.assertTrue(cfg["enabled"])

    def test_mi_core_config_preferred_over_agent_coding(self):
        config = {
            "mi_core": {"enabled": True, "base_url": "http://mi-core:3456"},
            "agent_coding": {"enabled": True, "base_url": "http://old:3456"},
        }
        with patch("services.machine_identity_service._load_local_config", return_value=config):
            import services.machine_identity_service as svc
            cfg = svc.get_agent_coding_config()
        self.assertEqual(cfg["base_url"], "http://mi-core:3456")


class TestHeartbeatPayload(unittest.TestCase):
    def test_heartbeat_includes_machine_id(self):
        from services.mi_core_client import MiCoreClient
        client = MiCoreClient(base_url="http://test:3456", timeout=5)
        payloads = []
        with patch.object(client, "_post", side_effect=lambda _, p: payloads.append(p) or True):
            mock_id = MagicMock(machine_id="qb-laptop-01", store_code="bandera", app_version="3.0")
            with patch("services.machine_identity_service.get_machine_identity", return_value=mock_id):
                client.heartbeat(status="ok", qb_open=True, qb_company="Bakudan Bandera")
        self.assertEqual(payloads[0]["machine_id"], "qb-laptop-01")
        self.assertTrue(payloads[0]["qb_open"])

    def test_activity_log_payload_has_file_id(self):
        from services.mi_core_client import MiCoreClient
        client = MiCoreClient(base_url="http://test:3456", timeout=5)
        payloads = []
        with patch.object(client, "_post", side_effect=lambda _, p: payloads.append(p) or True):
            mock_id = MagicMock(machine_id="m1", store_code="s1", app_version="3.0")
            with patch("services.machine_identity_service.get_machine_identity", return_value=mock_id):
                client.activity_log_result("2026-06-09", file_id="bandera", total_transactions=42)
        self.assertEqual(payloads[0]["file_id"], "bandera")
        self.assertEqual(payloads[0]["total_transactions"], 42)

    def test_timeline_payload_has_events(self):
        from services.mi_core_client import MiCoreClient
        client = MiCoreClient(base_url="http://test:3456", timeout=5)
        payloads = []
        events = [{"event_key": "sales_receipt", "event_time": "2026-06-09T10:00:00Z"}]
        with patch.object(client, "_post", side_effect=lambda _, p: payloads.append(p) or True):
            mock_id = MagicMock(machine_id="m1", store_code="s1", app_version="3.0")
            with patch("services.machine_identity_service.get_machine_identity", return_value=mock_id):
                client.timeline_result("2026-06-09", file_id="bandera", events=events)
        self.assertEqual(payloads[0]["events"], events)
        self.assertEqual(payloads[0]["file_id"], "bandera")


class TestRemoteCommandStructure(unittest.TestCase):
    def test_run_file_sync_command_has_file_id(self):
        """Verify RUN_FILE_SYNC_NOW command payload includes file_id."""
        from services.remote_command_client import CommandType, RemoteCommand
        cmd = RemoteCommand(
            command_id="test-cmd-01",
            command_type=CommandType.RUN_FILE_SYNC_NOW,
            payload={"file_id": "bakudan-bandera", "force": True},
        )
        self.assertEqual(cmd.payload["file_id"], "bakudan-bandera")
        self.assertTrue(cmd.payload["force"])

    def test_all_new_command_types_exist(self):
        from services.remote_command_client import CommandType
        expected = [
            "SCAN_QB_FILES", "RUN_12H_SYNC_NOW", "RUN_FILE_SYNC_NOW",
            "ENABLE_QB_FILE", "DISABLE_QB_FILE", "TEST_QB_FILE_CONNECTION",
            "TRIGGER_SYNC",
        ]
        existing = {ct.value for ct in CommandType}
        for cmd in expected:
            self.assertIn(cmd, existing, f"CommandType.{cmd} missing")

    def test_poll_commands_returns_list(self):
        from services.mi_core_client import MiCoreClient
        client = MiCoreClient(base_url="http://test:3456", timeout=5)
        with patch.object(client, "_get", return_value={"commands": []}):
            result = client.poll_commands()
        self.assertEqual(result, [])

    def test_ack_command_posts_correct_path(self):
        from services.mi_core_client import MiCoreClient
        client = MiCoreClient(base_url="http://test:3456", timeout=5)
        posted = []
        with patch.object(client, "_post", side_effect=lambda p, _: posted.append(p) or True):
            client.ack_command("cmd-123")
        self.assertIn("/api/qb-agent/commands/cmd-123/ack", posted)


if __name__ == "__main__":
    unittest.main()
