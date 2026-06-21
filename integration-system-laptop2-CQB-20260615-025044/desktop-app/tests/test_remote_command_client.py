"""
Tests for services/remote_command_client.py
"""
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch
import pytest

# Add desktop-app to path
sys.path.insert(0, str(Path(__file__).parent.parent))


class TestRemoteCommandClientCommandTypes:
    """Test command type constants."""

    def test_all_required_command_types_exist(self):
        """All 10 required command types are defined."""
        from services.remote_command_client import CommandType

        expected = [
            "OPEN_QB_NOW",
            "TEST_QB_CONNECTION",
            "GENERATE_ACTIVITY_LOG_NOW",
            "GENERATE_TIMELINE_NOW",
            "RUN_AUTO_SYNC_NOW",
            "TRIGGER_SYNC",
            "OPEN_LOG_FOLDER",
            "RESTART_AGENT",
            "STOP_AGENT",
            "REFRESH_CONFIG",
            "UPLOAD_LATEST_LOGS",
        ]
        for name in expected:
            assert hasattr(CommandType, name), f"Missing command type: {name}"

    def test_command_status_constants(self):
        """All command lifecycle statuses are defined."""
        from services.remote_command_client import CommandStatus

        assert CommandStatus.PENDING.value == "PENDING"
        assert CommandStatus.ACKNOWLEDGED.value == "ACKNOWLEDGED"
        assert CommandStatus.RUNNING.value == "RUNNING"
        assert CommandStatus.COMPLETED.value == "COMPLETED"
        assert CommandStatus.FAILED.value == "FAILED"
        assert CommandStatus.TIMEOUT.value == "TIMEOUT"

    def test_from_str_parses_valid_types(self):
        """from_str correctly parses valid command type strings."""
        from services.remote_command_client import CommandType

        assert CommandType.from_str("OPEN_QB_NOW") == CommandType.OPEN_QB_NOW
        assert CommandType.from_str("GENERATE_ACTIVITY_LOG_NOW") == CommandType.GENERATE_ACTIVITY_LOG_NOW
        assert CommandType.from_str("GENERATE_TIMELINE_NOW") == CommandType.GENERATE_TIMELINE_NOW
        assert CommandType.from_str("RESTART_AGENT") == CommandType.RESTART_AGENT

    def test_from_str_fallback_for_unknown(self):
        """from_str returns REFRESH_CONFIG for unknown command types."""
        from services.remote_command_client import CommandType

        assert CommandType.from_str("UNKNOWN_COMMAND_XYZ") == CommandType.REFRESH_CONFIG


class TestRemoteCommandClientPoll:
    """Test command polling."""

    def test_poll_returns_empty_list_when_offline(self):
        """poll() returns empty list when Agent-Coding is unreachable."""
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

            import urllib.error
            mock_urlopen.side_effect = urllib.error.URLError("Connection refused")

            client = RemoteCommandClient(base_url="http://localhost:3456")
            commands = client.poll()

            assert commands == []

    def test_poll_parses_command_list(self):
        """poll() correctly parses command list from Agent-Coding response."""
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
            mock_response.read.return_value = json.dumps([
                {
                    "command_id": "cmd-001",
                    "command_type": "GENERATE_ACTIVITY_LOG_NOW",
                    "payload_json": {"force": True},
                    "status": "PENDING",
                    "created_at": "2026-06-05T09:00:00Z",
                }
            ]).encode("utf-8")
            mock_urlopen.return_value = mock_response

            client = RemoteCommandClient(base_url="http://localhost:3456")
            commands = client.poll()

            assert len(commands) == 1
            assert commands[0].command_id == "cmd-001"
            assert commands[0].command_type == "GENERATE_ACTIVITY_LOG_NOW"
            assert commands[0].payload == {"force": True}

    def test_poll_parses_mi_core_command_shape(self):
        """poll() accepts Mi-Core id/type plus JSON-string payload."""
        from services.remote_command_client import RemoteCommandClient

        with patch("services.remote_command_client.get_machine_identity") as mock_id, \
             patch("services.remote_command_client.get_agent_coding_config") as mock_cfg, \
             patch("services.remote_command_client.get_api_key") as mock_key, \
             patch("urllib.request.urlopen") as mock_urlopen:

            mock_identity = MagicMock()
            mock_identity.machine_id = "qb-laptop-01"
            mock_identity.app_version = "dev1-v2"
            mock_id.return_value = mock_identity
            mock_cfg.return_value = {"poll_commands_seconds": 60, "timeout_seconds": 5}
            mock_key.return_value = "test-key"

            mock_response = MagicMock()
            mock_response.status = 200
            mock_response.__enter__ = MagicMock(return_value=mock_response)
            mock_response.__exit__ = MagicMock(return_value=False)
            mock_response.read.return_value = json.dumps({
                "commands": [
                    {
                        "id": "cmd-001",
                        "type": "TRIGGER_SYNC",
                        "payload_json": "{\"force\": true}",
                        "status": "pending",
                    }
                ]
            }).encode("utf-8")
            mock_urlopen.return_value = mock_response

            client = RemoteCommandClient(base_url="http://localhost:4001")
            commands = client.poll()

            assert len(commands) == 1
            assert commands[0].command_id == "cmd-001"
            assert commands[0].command_type == "TRIGGER_SYNC"
            assert commands[0].payload == {"force": True}


class TestRemoteCommandClientExecution:
    """Test command execution lifecycle."""

    def test_execute_command_calls_handler(self):
        """execute_command() calls the registered handler."""
        from services.remote_command_client import RemoteCommandClient, RemoteCommand, CommandStatus

        with patch("services.remote_command_client.get_machine_identity") as mock_id, \
             patch("services.remote_command_client.get_agent_coding_config") as mock_cfg, \
             patch("services.remote_command_client.get_api_key") as mock_key:

            mock_identity = MagicMock()
            mock_identity.machine_id = "test-machine"
            mock_identity.app_version = "v2.3.0"
            mock_id.return_value = mock_identity
            mock_cfg.return_value = {"poll_commands_seconds": 15, "timeout_seconds": 5}
            mock_key.return_value = "test-key"

            client = RemoteCommandClient(base_url="http://localhost:3456")

            handler_called = {}

            def my_handler(cmd: RemoteCommand) -> dict:
                handler_called["called"] = True
                handler_called["cmd_id"] = cmd.command_id
                return {"ok": True, "result": "test ok"}

            from services.remote_command_client import CommandType
            client.register_command_handler(
                CommandType.OPEN_QB_NOW,
                my_handler
            )

            cmd = RemoteCommand(
                command_id="cmd-test-001",
                command_type="OPEN_QB_NOW",
                payload={},
            )
            result = client.execute_command(cmd)

            assert handler_called["called"] is True
            assert handler_called["cmd_id"] == "cmd-test-001"
            assert result["ok"] is True

    def test_execute_command_no_handler_uses_noop(self):
        """execute_command() uses NoOpExecutor when no handler registered."""
        from services.remote_command_client import RemoteCommandClient, RemoteCommand

        with patch("services.remote_command_client.get_machine_identity") as mock_id, \
             patch("services.remote_command_client.get_agent_coding_config") as mock_cfg, \
             patch("services.remote_command_client.get_api_key") as mock_key:

            mock_identity = MagicMock()
            mock_identity.machine_id = "test-machine"
            mock_identity.app_version = "v2.3.0"
            mock_id.return_value = mock_identity
            mock_cfg.return_value = {"poll_commands_seconds": 15, "timeout_seconds": 5}
            mock_key.return_value = "test-key"

            client = RemoteCommandClient(base_url="http://localhost:3456")

            cmd = RemoteCommand(
                command_id="cmd-test-002",
                command_type="GENERATE_TIMELINE_NOW",
                payload={},
            )
            result = client.execute_command(cmd)

            # NoOpExecutor returns ok=True
            assert result.get("ok") is True
            assert result.get("executed_by") == "NoOpExecutor"


class TestRemoteCommandClientDeduplication:
    """Test duplicate command skip."""

    def test_process_commands_skips_duplicates(self):
        """process_commands() skips already-seen command IDs."""
        from services.remote_command_client import RemoteCommandClient

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

            from services.remote_command_client import RemoteCommand
            cmd = RemoteCommand(
                command_id="cmd-duplicate-001",
                command_type="OPEN_QB_NOW",
                payload={},
            )
            mock_poll.return_value = [cmd]
            mock_exec.return_value = {"ok": True}

            client = RemoteCommandClient(base_url="http://localhost:3456")

            # Process once
            n1 = client.process_commands()
            assert n1 == 1
            assert "cmd-duplicate-001" in client._seen_ids

            # Process again — should skip duplicate
            n2 = client.process_commands()
            assert n2 == 0  # No new commands
