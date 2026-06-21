"""
Tests for remote commands (command queue, execution, lifecycle)
"""
import sys
from pathlib import Path
import json
import time
from unittest.mock import MagicMock, patch
import pytest

# Test file is at desktop-app/tests/, so add desktop-app to path
DESKTOP_APP = Path(__file__).resolve().parent.parent
if str(DESKTOP_APP) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP))


class TestRemoteCommands:
    """Test command queue, execution, and lifecycle."""

    def test_write_command_creates_file(self, tmp_path):
        """write_command() creates JSON file in agent-commands/."""
        from services.agent_command_queue import write_command, read_all_pending_commands

        with patch("services.agent_command_queue._cmd_dir", return_value=tmp_path / "commands"), \
             patch("services.agent_command_queue._result_dir", return_value=tmp_path / "results"):

            cmd_id = write_command("GENERATE_ACTIVITY_LOG_NOW", payload={"force": True})
            assert cmd_id.startswith("cmd-")

            pending = read_all_pending_commands()
            assert len(pending) == 1
            assert pending[0]["type"] == "GENERATE_ACTIVITY_LOG_NOW"
            assert pending[0]["payload"] == {"force": True}

    def test_command_lifecycle_pending_to_completed(self, tmp_path):
        """Command goes PENDING -> PROCESSING -> COMPLETED."""
        from services.agent_command_queue import (
            write_command, mark_command_processing, complete_command, read_command, read_result
        )

        with patch("services.agent_command_queue._cmd_dir", return_value=tmp_path / "commands"), \
             patch("services.agent_command_queue._result_dir", return_value=tmp_path / "results"):

            cmd_id = write_command("TEST_QB_CONNECTION", payload={})

            # Mark processing
            mark_command_processing(cmd_id)
            cmd = read_command(cmd_id)
            assert cmd["status"] == "PROCESSING"

            # Complete
            complete_command(cmd_id, {"ok": True, "message": "Test passed"})
            cmd = read_command(cmd_id)
            assert cmd["status"] == "COMPLETED"

            result = read_result(cmd_id)
            assert result["result"]["ok"] is True

    def test_command_failure_recorded(self, tmp_path):
        """Failed command marked FAILED with error."""
        from services.agent_command_queue import write_command, fail_command, read_command

        with patch("services.agent_command_queue._cmd_dir", return_value=tmp_path / "commands"), \
             patch("services.agent_command_queue._result_dir", return_value=tmp_path / "results"):

            cmd_id = write_command("OPEN_QB_NOW", payload={})
            fail_command(cmd_id, "QB exe not found")

            cmd = read_command(cmd_id)
            assert cmd["status"] == "FAILED"
            assert cmd["error"] == "QB exe not found"

    def test_execute_command_generate_activity_log(self, tmp_path):
        """execute_command calls scheduler trigger_now for activity log."""
        from services.agent_command_queue import execute_command

        mock_sched = MagicMock()
        mock_sched.trigger_now.return_value = {"ok": True, "results": [{"store": "bandera", "status": "PASS"}]}

        result = execute_command(
            {"type": "GENERATE_ACTIVITY_LOG_NOW", "payload": {"force": True}},
            qb_activity_log_scheduler=mock_sched,
        )

        assert result["ok"] is True
        mock_sched.trigger_now.assert_called_once_with(force=True)

    def test_execute_command_generate_timeline(self, tmp_path):
        """execute_command calls scheduler trigger_now for timeline."""
        from services.agent_command_queue import execute_command

        mock_sched = MagicMock()
        mock_sched.trigger_now.return_value = {"ok": True, "results": [{"store": "bandera", "status": "PASS"}]}

        result = execute_command(
            {"type": "GENERATE_TIMELINE_NOW", "payload": {"force": True}},
            qb_timeline_scheduler=mock_sched,
        )

        assert result["ok"] is True
        mock_sched.trigger_now.assert_called_once_with(force=True)

    def test_execute_command_open_qb_now(self, tmp_path):
        """execute_command calls QB startup service run_now for OPEN_QB_NOW."""
        from services.agent_command_queue import execute_command

        mock_qb = MagicMock()
        mock_status = MagicMock()
        mock_status.status = "QB_READY"
        mock_status.message = "QB is ready"
        mock_qb.get_status.return_value = mock_status
        mock_qb.run_now.return_value = mock_status

        result = execute_command(
            {"type": "OPEN_QB_NOW", "payload": {}},
            qb_startup_service=mock_qb,
        )

        assert result["ok"] is True
        assert result["status"] == "QB_READY"

    def test_execute_command_test_qb_connection(self, tmp_path):
        """execute_command tests QB connection."""
        from services.agent_command_queue import execute_command

        mock_qb = MagicMock()
        mock_status = MagicMock()
        mock_status.status = "QB_WRONG_CO"
        mock_status.message = "Wrong company"
        mock_qb.get_status.return_value = mock_status
        mock_qb.run_now.return_value = mock_status

        result = execute_command(
            {"type": "TEST_QB_CONNECTION", "payload": {}},
            qb_startup_service=mock_qb,
        )

        assert result["ok"] is True
        assert result["status"] == "QB_WRONG_CO"

    def test_execute_command_run_auto_sync(self, tmp_path):
        """execute_command triggers auto sync scheduler."""
        from services.agent_command_queue import execute_command

        mock_sched = MagicMock()
        mock_status = MagicMock()
        mock_status.status = "Completed"
        mock_status.message = "Sync completed"
        mock_sched.trigger_now.return_value = mock_status

        result = execute_command(
            {"type": "RUN_AUTO_SYNC_NOW", "payload": {}},
            auto_sync_scheduler=mock_sched,
        )

        assert result["ok"] is True
        mock_sched.trigger_now.assert_called_once()

    def test_unknown_command_type_rejected(self):
        """write_command rejects unknown command types."""
        from services.agent_command_queue import write_command

        with patch("services.agent_command_queue._cmd_dir", return_value=MagicMock()), \
             patch("services.agent_command_queue._result_dir", return_value=MagicMock()):

            try:
                write_command("UNKNOWN_COMMAND", payload={})
                assert False, "Should have raised ValueError"
            except ValueError as e:
                assert "Unsupported command type" in str(e)

    def test_supported_commands_list(self):
        """SUPPORTED_COMMANDS contains all required types."""
        from services.agent_command_queue import SUPPORTED_COMMANDS

        expected = {
            "OPEN_QB_NOW",
            "TEST_QB_CONNECTION",
            "GENERATE_ACTIVITY_LOG_NOW",
            "GENERATE_TIMELINE_NOW",
            "RUN_AUTO_SYNC_NOW",
            "OPEN_LOG_FOLDER",
            "STOP_AGENT",
            "RESTART_AGENT",
        }
        assert SUPPORTED_COMMANDS == expected


class TestRemoteCommandClient:
    """Test remote_command_client.py polling and execution."""

    def test_command_types_defined(self):
        """All 10 command types exist in CommandType enum."""
        from services.remote_command_client import CommandType

        expected = [
            "OPEN_QB_NOW", "TEST_QB_CONNECTION", "GENERATE_ACTIVITY_LOG_NOW",
            "GENERATE_TIMELINE_NOW", "RUN_AUTO_SYNC_NOW", "OPEN_LOG_FOLDER",
            "RESTART_AGENT", "STOP_AGENT", "REFRESH_CONFIG", "UPLOAD_LATEST_LOGS",
            "TRIGGER_SYNC",
        ]
        for name in expected:
            assert hasattr(CommandType, name)

    def test_command_status_lifecycle(self):
        """CommandStatus has PENDING/ACKNOWLEDGED/RUNNING/COMPLETED/FAILED/TIMEOUT."""
        from services.remote_command_client import CommandStatus

        assert CommandStatus.PENDING.value == "PENDING"
        assert CommandStatus.ACKNOWLEDGED.value == "ACKNOWLEDGED"
        assert CommandStatus.RUNNING.value == "RUNNING"
        assert CommandStatus.COMPLETED.value == "COMPLETED"
        assert CommandStatus.FAILED.value == "FAILED"
        assert CommandStatus.TIMEOUT.value == "TIMEOUT"

    def test_poll_returns_empty_on_offline(self):
        """poll() returns [] when Agent-Coding unreachable."""
        from services.remote_command_client import RemoteCommandClient
        import urllib.error

        with patch("services.remote_command_client.get_machine_identity") as mock_id, \
             patch("services.remote_command_client.get_agent_coding_config") as mock_cfg, \
             patch("services.remote_command_client.get_api_key") as mock_key, \
             patch("urllib.request.urlopen") as mock_urlopen:

            mock_identity = MagicMock()
            mock_identity.machine_id = "test-machine"
            mock_identity.app_version = "v2.3.0"
            mock_id.return_value = mock_identity
            mock_cfg.return_value = {"poll_commands_seconds": 15, "timeout_seconds": 5}
            mock_key.return_value = "test-key"

            mock_urlopen.side_effect = urllib.error.URLError("Connection refused")

            client = RemoteCommandClient(base_url="http://localhost:3456")
            commands = client.poll()
            assert commands == []

    def test_deduplication_skips_duplicate_commands(self):
        """process_commands skips already-seen command IDs."""
        from services.remote_command_client import RemoteCommandClient, RemoteCommand

        with patch("services.remote_command_client.get_machine_identity") as mock_id, \
             patch("services.remote_command_client.get_agent_coding_config") as mock_cfg, \
             patch("services.remote_command_client.get_api_key") as mock_key, \
             patch.object(RemoteCommandClient, "poll") as mock_poll, \
             patch.object(RemoteCommandClient, "acknowledge") as mock_ack, \
             patch.object(RemoteCommandClient, "execute_command") as mock_exec:

            mock_identity = MagicMock()
            mock_identity.machine_id = "test-machine"
            mock_identity.app_version = "v2.3.0"
            mock_id.return_value = mock_identity
            mock_cfg.return_value = {"poll_commands_seconds": 15, "timeout_seconds": 5}
            mock_key.return_value = "test-key"

            cmd = RemoteCommand(command_id="cmd-dup-001", command_type="OPEN_QB_NOW", payload={})
            mock_poll.return_value = [cmd]
            mock_exec.return_value = {"ok": True}

            client = RemoteCommandClient(base_url="http://localhost:3456")
            n1 = client.process_commands()
            assert n1 == 1

            n2 = client.process_commands()
            assert n2 == 0

    def test_acknowledge_posts_to_agent_coding(self):
        """acknowledge() posts ACK to /commands/{id}/ack."""
        from services.remote_command_client import RemoteCommandClient

        with patch("services.remote_command_client.get_machine_identity") as mock_id, \
             patch("services.remote_command_client.get_agent_coding_config") as mock_cfg, \
             patch("services.remote_command_client.get_api_key") as mock_key, \
             patch("urllib.request.urlopen") as mock_urlopen:

            mock_identity = MagicMock()
            mock_identity.machine_id = "test-machine"
            mock_identity.app_version = "v2.3.0"
            mock_id.return_value = mock_identity
            mock_cfg.return_value = {"poll_commands_seconds": 15, "timeout_seconds": 5}
            mock_key.return_value = "test-key"

            mock_response = MagicMock()
            mock_response.status = 200
            mock_response.__enter__ = MagicMock(return_value=mock_response)
            mock_response.__exit__ = MagicMock(return_value=False)
            mock_urlopen.return_value = mock_response

            client = RemoteCommandClient(base_url="http://localhost:3456")
            ok = client.acknowledge("cmd-001")
            assert ok is True

    def test_post_result_posts_to_agent_coding(self):
        """post_result() posts result to /commands/{id}/complete."""
        from services.remote_command_client import RemoteCommandClient, RemoteCommand

        with patch("services.remote_command_client.get_machine_identity") as mock_id, \
             patch("services.remote_command_client.get_agent_coding_config") as mock_cfg, \
             patch("services.remote_command_client.get_api_key") as mock_key, \
             patch("urllib.request.urlopen") as mock_urlopen:

            mock_identity = MagicMock()
            mock_identity.machine_id = "test-machine"
            mock_identity.app_version = "v2.3.0"
            mock_id.return_value = mock_identity
            mock_cfg.return_value = {"poll_commands_seconds": 15, "timeout_seconds": 5}
            mock_key.return_value = "test-key"

            mock_response = MagicMock()
            mock_response.status = 200
            mock_response.__enter__ = MagicMock(return_value=mock_response)
            mock_response.__exit__ = MagicMock(return_value=False)
            mock_urlopen.return_value = mock_response

            client = RemoteCommandClient(base_url="http://localhost:3456")
            cmd = RemoteCommand(command_id="cmd-001", command_type="OPEN_QB_NOW", payload={}, status="COMPLETED", result={"ok": True})
            ok = client.post_result(cmd)
            assert ok is True
            request = mock_urlopen.call_args[0][0]
            assert request.full_url == "http://localhost:3456/api/qb-agent/commands/cmd-001/complete"
            body = json.loads(request.data.decode("utf-8"))
            assert body["status"] == "completed"
            assert body["result_json"] == {"ok": True}
