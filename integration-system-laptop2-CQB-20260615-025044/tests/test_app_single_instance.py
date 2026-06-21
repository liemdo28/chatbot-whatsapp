"""
Tests for services/app_single_instance.py
"""

import json
import os
import sys
from pathlib import Path

import pytest

# Add desktop-app to Python path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "desktop-app"))

import services.app_single_instance as mod


class TestAppSingleInstance:
    """Test the single instance lock and heartbeat system."""

    def test_lock_file_path_creation(self, tmp_path, monkeypatch):
        """Lock file path is created in runtime directory."""
        def mock_runtime_path(*parts):
            return tmp_path / "runtime"

        monkeypatch.setattr("app_paths.runtime_path", mock_runtime_path)

        path = mod._lock_file_path()
        assert path.name == "background-agent.lock"

    def test_heartbeat_path(self, tmp_path, monkeypatch):
        """Heartbeat path is in runtime directory."""
        def mock_runtime_path(*parts):
            return tmp_path / "runtime"

        monkeypatch.setattr("app_paths.runtime_path", mock_runtime_path)

        path = mod._heartbeat_path()
        assert path.name == "agent-heartbeat.json"

    def test_is_agent_running_returns_false_when_no_lock(self, tmp_path, monkeypatch):
        """When no lock file exists, agent is not running."""
        def mock_runtime_path(*parts):
            return tmp_path / "runtime"

        monkeypatch.setattr("app_paths.runtime_path", mock_runtime_path)

        result = mod.is_agent_running()
        assert result is False

    def test_acquire_lock_creates_file(self, tmp_path, monkeypatch):
        """Acquiring lock creates the lock file."""
        def mock_runtime_path(*parts):
            return tmp_path / "runtime"

        monkeypatch.setattr("app_paths.runtime_path", mock_runtime_path)
        monkeypatch.setattr("os.getpid", lambda: 99999)

        result = mod.acquire_agent_lock(mode="background")
        assert result is True

        lock = tmp_path / "runtime" / "background-agent.lock"
        assert lock.exists()
        data = json.loads(lock.read_text(encoding="utf-8"))
        assert data["pid"] == 99999
        assert data["mode"] == "background"
        assert "started_at" in data

    def test_acquire_lock_fails_when_already_running(self, tmp_path, monkeypatch):
        """Cannot acquire lock when agent is already running (same PID)."""
        def mock_runtime_path(*parts):
            return tmp_path / "runtime"

        monkeypatch.setattr("app_paths.runtime_path", mock_runtime_path)
        monkeypatch.setattr("os.getpid", lambda: 99999)
        monkeypatch.setattr("os.kill", lambda pid, sig: None)

        # First acquisition succeeds
        result1 = mod.acquire_agent_lock(mode="background")
        assert result1 is True

        # Second acquisition fails
        result2 = mod.acquire_agent_lock(mode="background")
        assert result2 is False

    def test_stale_lock_is_cleaned(self, tmp_path, monkeypatch):
        """Dead PID lock is detected and removed."""
        def mock_runtime_path(*parts):
            return tmp_path / "runtime"

        monkeypatch.setattr("app_paths.runtime_path", mock_runtime_path)

        # Write a lock file with a dead PID
        lock = tmp_path / "runtime" / "background-agent.lock"
        lock.parent.mkdir(parents=True, exist_ok=True)
        lock.write_text(json.dumps({"pid": 99999, "mode": "background", "started_at": "2026-01-01T00:00:00Z"}), encoding="utf-8")

        # os.kill raises OSError for dead PIDs
        def dead_kill(pid, sig):
            raise OSError("Process not found")

        monkeypatch.setattr("os.kill", dead_kill)

        result = mod.is_agent_running()
        assert result is False
        assert not lock.exists()  # Stale lock removed

    def test_release_lock_removes_file(self, tmp_path, monkeypatch):
        """Releasing lock removes the lock file (only if it's ours)."""
        def mock_runtime_path(*parts):
            return tmp_path / "runtime"

        monkeypatch.setattr("app_paths.runtime_path", mock_runtime_path)
        monkeypatch.setattr("os.getpid", lambda: 12345)

        # Create a lock file with our PID
        lock = tmp_path / "runtime" / "background-agent.lock"
        lock.parent.mkdir(parents=True, exist_ok=True)
        lock.write_text(json.dumps({"pid": 12345, "mode": "background", "started_at": "2026-01-01T00:00:00Z"}), encoding="utf-8")
        assert lock.exists()

        mod.release_agent_lock()
        assert not lock.exists()

    def test_write_heartbeat_creates_file(self, tmp_path, monkeypatch):
        """Writing heartbeat creates the heartbeat file."""
        def mock_runtime_path(*parts):
            return tmp_path / "runtime"

        monkeypatch.setattr("app_paths.runtime_path", mock_runtime_path)

        mod.write_heartbeat(
            status="AGENT_RUNNING",
            started_at="2026-06-05T09:00:00Z",
            qb_status="QB_READY",
            activity_log_status="Done",
            timeline_status="Done",
            auto_sync_status="Off",
            last_error="",
        )

        hb = tmp_path / "runtime" / "agent-heartbeat.json"
        assert hb.exists()
        data = json.loads(hb.read_text(encoding="utf-8"))
        assert data["status"] == "AGENT_RUNNING"
        assert data["qb_status"] == "QB_READY"
        assert data["activity_log_status"] == "Done"
        assert data["timeline_status"] == "Done"
        assert data["pid"] == os.getpid()

    def test_read_heartbeat_returns_none_when_not_exists(self, tmp_path, monkeypatch):
        """Reading heartbeat returns None when no file exists."""
        def mock_runtime_path(*parts):
            return tmp_path / "runtime"

        monkeypatch.setattr("app_paths.runtime_path", mock_runtime_path)

        result = mod.read_heartbeat()
        assert result is None

    def test_read_heartbeat_returns_data_when_exists(self, tmp_path, monkeypatch):
        """Reading heartbeat returns the heartbeat data when file exists."""
        def mock_runtime_path(*parts):
            return tmp_path / "runtime"

        monkeypatch.setattr("app_paths.runtime_path", mock_runtime_path)

        # Create heartbeat file
        hb = tmp_path / "runtime" / "agent-heartbeat.json"
        hb.parent.mkdir(parents=True, exist_ok=True)
        hb.write_text(json.dumps({"status": "AGENT_RUNNING", "pid": 99999}), encoding="utf-8")

        result = mod.read_heartbeat()
        assert result is not None
        assert result["status"] == "AGENT_RUNNING"
        assert result["pid"] == 99999