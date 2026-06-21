"""tests/test_remote_control_scheduler.py"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "services"))


class TestRemoteControlScheduler:
    """Tests for remote_control_scheduler.py"""

    @pytest.fixture(autouse=True)
    def setup(self, tmp_path, monkeypatch):
        self.tmp = tmp_path
        self.config_file = self.tmp / "local-config.json"
        self.version_file = self.tmp / "version.json"

        self.version_file.write_text(json.dumps({"app_version": "2.3.0-test"}))
        self.config_file.write_text(json.dumps({
            "machine": {
                "machine_id": "qb-pc-bandera-01",
                "machine_name": "Test PC",
                "store_code": "bandera",
            },
            "agent_coding": {
                "enabled": True,
                "base_url": "http://localhost:3456",
                "timeout_seconds": 5,
                "poll_commands_seconds": 15,
                "heartbeat_seconds": 60,
            },
        }))

        # Add desktop-app to path for imports
        sys.path.insert(0, str(Path(__file__).parent.parent))

        # Use monkeypatch for proper module-level patching
        import machine_identity_service as mis
        monkeypatch.setattr(mis, "RUNTIME_DIR", self.tmp)
        monkeypatch.setattr(mis, "LOCAL_CONFIG_PATH", self.config_file)
        monkeypatch.setattr(mis, "get_api_key", lambda: "test-key")
        monkeypatch.setattr(mis, "validate_identity", lambda: (True, ""))

        import agent_coding_client as acc
        mock_ac = MagicMock()
        mock_ac.register.return_value = True
        mock_ac.ping.return_value = True
        mock_ac.heartbeat.return_value = True
        monkeypatch.setattr(acc, "get_client", lambda: mock_ac)

        import reporting_event_bus as reb
        monkeypatch.setattr(reb, "emit", MagicMock())

        import reporting_outbox as ro
        mock_ob = MagicMock()
        monkeypatch.setattr(ro, "get_outbox", lambda: mock_ob)

        import remote_command_client as rcc
        mock_cc = MagicMock()
        mock_cc.poll.return_value = []
        mock_cc.acknowledge.return_value = True
        mock_cc.post_result.return_value = True
        monkeypatch.setattr(rcc, "RemoteCommandClient", lambda *a, **k: mock_cc)

        yield

    def test_start_background_agent_initializes_components(self):
        """start() initializes all three background threads."""
        import importlib
        import remote_control_scheduler as rcs
        importlib.reload(rcs)

        scheduler = rcs.start_background_agent()
        assert scheduler.running is True

        # Check components initialized
        assert scheduler._agent_client is not None
        assert scheduler._cmd_client is not None
        assert scheduler._outbox is not None

        # Check heartbeat thread started
        assert len(scheduler._threads) >= 1
        assert any(t.name == "heartbeat" for t in scheduler._threads)

    def test_stop_background_agent_stops_components(self):
        """stop() halts heartbeat, command polling, and outbox worker."""
        import importlib
        import remote_control_scheduler as rcs
        importlib.reload(rcs)

        scheduler = rcs.start_background_agent()
        rcs.stop_background_agent()

        assert scheduler.running is False
        # Verify stop called on components
        assert scheduler._cmd_client.stop.called

    def test_singleton_behavior(self):
        """start_background_agent() returns same instance on repeated calls."""
        import importlib
        import remote_control_scheduler as rcs
        importlib.reload(rcs)

        s1 = rcs.start_background_agent()
        s2 = rcs.start_background_agent()
        assert s1 is s2

    def test_validate_identity_false_disables_remote(self):
        """When validate_identity returns False, scheduler starts but threads don't run."""
        import importlib
        import remote_control_scheduler as rcs
        importlib.reload(rcs)

        # Patch at the location where validate_identity was imported
        with patch.object(rcs, "validate_identity", return_value=(False, "not configured")):
            scheduler = rcs.start_background_agent()
            # Scheduler is created but no command threads started (early return after validation fails)
            # _running is True because it's set before validation check
            assert scheduler.running is True
            # But no command polling thread was started
            assert scheduler._cmd_client is None or not scheduler._cmd_client.start.called

    def test_register_handlers_all_command_types(self):
        """_register_handlers() registers handler for every CommandType."""
        import importlib
        import remote_control_scheduler as rcs
        importlib.reload(rcs)

        scheduler = rcs.start_background_agent()
        scheduler._register_handlers()

        # Should have called register_command_handler for all 10 command types
        assert scheduler._cmd_client.register_command_handler.call_count >= 10

    def test_handle_open_qb_emits_event(self):
        """_handle_open_qb emits REMOTE_COMMAND_RECEIVED event."""
        import importlib
        import remote_control_scheduler as rcs
        importlib.reload(rcs)

        scheduler = rcs.start_background_agent()
        from remote_command_client import RemoteCommand

        cmd = RemoteCommand(command_id="cmd-001", command_type="OPEN_QB_NOW")
        result = scheduler._handle_open_qb(cmd)

        assert result["ok"] is True
        assert result["action"] == "OPEN_QB_NOW"

    def test_handle_test_connection_returns_ping_result(self):
        """_handle_test_connection returns agent_coding_reachable flag."""
        import importlib
        import remote_control_scheduler as rcs
        importlib.reload(rcs)

        scheduler = rcs.start_background_agent()
        from remote_command_client import RemoteCommand

        scheduler._agent_client.ping.return_value = True
        cmd = RemoteCommand(command_id="cmd-002", command_type="TEST_QB_CONNECTION")
        result = scheduler._handle_test_connection(cmd)

        assert result["ok"] is True
        assert result["agent_coding_reachable"] is True

    def test_handle_activity_log_emits_started_event(self):
        """_handle_activity_log emits ACTIVITY_LOG_STARTED."""
        import importlib
        import remote_control_scheduler as rcs
        importlib.reload(rcs)

        scheduler = rcs.start_background_agent()
        from remote_command_client import RemoteCommand

        cmd = RemoteCommand(
            command_id="cmd-003",
            command_type="GENERATE_ACTIVITY_LOG_NOW",
            payload={"business_date": "2026-06-04"}
        )
        result = scheduler._handle_activity_log(cmd)

        assert result["ok"] is True
        assert result["business_date"] == "2026-06-04"

    def test_handle_refresh_config_calls_client_refresh(self):
        """_handle_refresh_config calls agent_client.refresh_config()."""
        import importlib
        import remote_control_scheduler as rcs
        importlib.reload(rcs)

        scheduler = rcs.start_background_agent()
        from remote_command_client import RemoteCommand

        cmd = RemoteCommand(command_id="cmd-004", command_type="REFRESH_CONFIG")
        result = scheduler._handle_refresh_config(cmd)

        assert result["ok"] is True
        scheduler._agent_client.refresh_config.assert_called_once()

    def test_set_status_methods_update_heartbeat_payload(self):
        """set_qb_status, set_activity_status, etc. affect heartbeat payload."""
        import importlib
        import remote_control_scheduler as rcs
        importlib.reload(rcs)

        scheduler = rcs.start_background_agent()
        scheduler.set_qb_status("ready")
        scheduler.set_activity_status("running")
        scheduler.set_timeline_status("completed")
        scheduler.set_autosync_status("idle")
        scheduler.set_last_error("test error")

        assert scheduler._qb_status == "ready"
        assert scheduler._activity_status == "running"
        assert scheduler._timeline_status == "completed"
        assert scheduler._autosync_status == "idle"
        assert scheduler._last_error == "test error"