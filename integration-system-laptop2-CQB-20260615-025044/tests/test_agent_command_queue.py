"""
Tests for services/agent_command_queue.py
"""

import json
import os
import sys
from pathlib import Path

import pytest

# Add desktop-app to Python path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "desktop-app"))

import services.agent_command_queue as mod


class TestAgentCommandQueue:
    """Test the agent command queue system."""

    def test_write_command_creates_file(self, tmp_path, monkeypatch):
        """write_command creates a command JSON file."""
        def mock_runtime_path(*parts):
            # _cmd_dir returns runtime_path("runtime") / "agent-commands"
            return tmp_path / "runtime"

        monkeypatch.setattr("app_paths.runtime_path", mock_runtime_path)

        cmd_id = mod.write_command("GENERATE_ACTIVITY_LOG_NOW", {"force": True})
        assert cmd_id.startswith("cmd-")

        # Command goes to: tmp_path/runtime/agent-commands/{id}.json
        cmd_file = tmp_path / "runtime" / "agent-commands" / f"{cmd_id}.json"
        assert cmd_file.exists(), f"Expected {cmd_file}"

        data = json.loads(cmd_file.read_text(encoding="utf-8"))
        assert data["type"] == "GENERATE_ACTIVITY_LOG_NOW"
        assert data["status"] == "PENDING"
        assert data["payload"]["force"] is True

    def test_write_command_rejects_unknown_types(self, tmp_path, monkeypatch):
        """write_command raises ValueError for unknown command types."""
        def mock_runtime_path(*parts):
            return tmp_path / "runtime"

        monkeypatch.setattr("app_paths.runtime_path", mock_runtime_path)

        with pytest.raises(ValueError, match="Unsupported command"):
            mod.write_command("FAKE_COMMAND")

    def test_read_command_returns_data(self, tmp_path, monkeypatch):
        """read_command returns command data."""
        def mock_runtime_path(*parts):
            return tmp_path / "runtime"

        monkeypatch.setattr("app_paths.runtime_path", mock_runtime_path)

        cmd_id = mod.write_command("GENERATE_TIMELINE_NOW", {"force": False})

        result = mod.read_command(cmd_id)
        assert result is not None
        assert result["type"] == "GENERATE_TIMELINE_NOW"
        assert result["status"] == "PENDING"

    def test_read_command_returns_none_for_missing(self, tmp_path, monkeypatch):
        """read_command returns None when command doesn't exist."""
        def mock_runtime_path(*parts):
            return tmp_path / "runtime"

        monkeypatch.setattr("app_paths.runtime_path", mock_runtime_path)

        result = mod.read_command("cmd-does-not-exist")
        assert result is None

    def test_read_all_pending_commands_returns_pending_only(self, tmp_path, monkeypatch):
        """read_all_pending_commands returns only PENDING commands."""
        def mock_runtime_path(*parts):
            return tmp_path / "runtime"

        monkeypatch.setattr("app_paths.runtime_path", mock_runtime_path)

        id1 = mod.write_command("GENERATE_ACTIVITY_LOG_NOW")
        id2 = mod.write_command("GENERATE_TIMELINE_NOW")

        pending = mod.read_all_pending_commands()
        pending_ids = [p["id"] for p in pending]
        assert id1 in pending_ids
        assert id2 in pending_ids

        # Mark one as completed
        mod.complete_command(id1, {"ok": True})

        pending2 = mod.read_all_pending_commands()
        pending2_ids = [p["id"] for p in pending2]
        assert id1 not in pending2_ids

    def test_complete_command_marks_completed_and_writes_result(self, tmp_path, monkeypatch):
        """complete_command marks command as COMPLETED and writes result."""
        def mock_runtime_path(*parts):
            return tmp_path / "runtime"

        monkeypatch.setattr("app_paths.runtime_path", mock_runtime_path)

        cmd_id = mod.write_command("GENERATE_ACTIVITY_LOG_NOW")

        result = {"ok": True, "stores": ["bandera", "stone_oak"]}
        mod.complete_command(cmd_id, result)

        # Command file should be COMPLETED
        cmd_file = tmp_path / "runtime" / "agent-commands" / f"{cmd_id}.json"
        cmd_data = json.loads(cmd_file.read_text(encoding="utf-8"))
        assert cmd_data["status"] == "COMPLETED"

        # Result file should exist in results dir
        result_dir = tmp_path / "runtime" / "agent-command-results"
        result_files = list(result_dir.glob(f"{cmd_id}.json"))
        assert len(result_files) == 1

    def test_fail_command_marks_failed(self, tmp_path, monkeypatch):
        """fail_command marks command as FAILED."""
        def mock_runtime_path(*parts):
            return tmp_path / "runtime"

        monkeypatch.setattr("app_paths.runtime_path", mock_runtime_path)

        cmd_id = mod.write_command("OPEN_QB_NOW")
        mod.fail_command(cmd_id, "QB not installed")

        cmd_file = tmp_path / "runtime" / "agent-commands" / f"{cmd_id}.json"
        cmd_data = json.loads(cmd_file.read_text(encoding="utf-8"))
        assert cmd_data["status"] == "FAILED"
        assert cmd_data["error"] == "QB not installed"

    def test_supported_commands_list(self):
        """SUPPORTED_COMMANDS contains all expected command types."""
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
        assert mod.SUPPORTED_COMMANDS == expected