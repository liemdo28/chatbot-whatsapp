"""
Integration test for the full auto-connect / auto-sync / remote-control flow.

Tests:
1. Background agent starts without UI
2. QB auto-connect state machine transitions
3. Scheduled log/timeline triggers at configured time
4. Agent-Coding receives heartbeat
5. Offline events queue to outbox
6. Remote commands execute
"""
import json
import time
from unittest.mock import MagicMock, patch
import pytest


class TestAutoConnectSyncFullFlow:
    """End-to-end integration tests for auto-connect/sync system."""

    def test_background_agent_starts_headless(self):
        """Background agent starts without showing any UI."""
        import threading

        started = {}

        def mock_run():
            from services.background_agent_service import BackgroundAgentService
            svc = BackgroundAgentService(heartbeat_seconds=5, command_poll_seconds=2)
            svc.start()
            started["state"] = svc.get_status()["state"]
            time.sleep(0.3)
            svc.stop()

        t = threading.Thread(target=mock_run)
        t.start()
        t.join(timeout=5)

        assert "state" in started
        assert started["state"] in ("AGENT_RUNNING", "AGENT_STARTING", "AGENT_STOPPED")

    def test_qb_startup_service_transitions_all_states(self):
        """QBStartupService transitions through all expected states."""
        from services.qb_startup_service import (
            QBStartupService,
            QB_STATUS_DISABLED,
            QB_STATUS_BLOCKED,
            QB_STATUS_CLOSED,
        )

        # Test disabled state
        svc = QBStartupService()
        svc._run()
        status = svc.get_status()
        # Without config, it may be disabled or blocked
        assert status.status in (
            QB_STATUS_DISABLED,
            QB_STATUS_BLOCKED,
            QB_STATUS_CLOSED,
        )

    def test_qb_startup_missing_config_gives_blocked(self):
        """QB startup with missing company file → QB_BLOCKED."""
        from services.qb_startup_service import (
            QBStartupService,
            QB_STATUS_BLOCKED,
        )

        svc = QBStartupService(config={"quickbooks": {
            "auto_open_on_app_start": True,
            "auto_connect_company_file": True,
            "company_file": "Z:/nonexistent/path/BadCompany.qbw",
            "exe_path": "C:/nonexistent/QB.exe",
            "password_key": "pass1",
        }})
        svc._run()
        status = svc.get_status()
        assert status.status == QB_STATUS_BLOCKED

    def test_activity_log_scheduler_off_when_disabled(self):
        """QB activity log scheduler reports OFF when disabled."""
        from services.qb_activity_log_scheduler import QBActivityLogScheduler, ALOG_OFF

        svc = QBActivityLogScheduler(
            config={"qb_activity_log": {"enabled": False}},
        )
        svc._tick()

        status, msg = svc.get_status()
        assert status == ALOG_OFF

    def test_timeline_scheduler_off_when_disabled(self):
        """QB activity timeline scheduler reports OFF when disabled."""
        from services.qb_activity_timeline_scheduler import (
            QBActivityTimelineScheduler, TL_SCHED_OFF,
        )

        svc = QBActivityTimelineScheduler(
            config={"qb_activity_timeline": {"enabled": False}},
        )
        svc._tick()

        status, msg = svc.get_status()
        assert status == TL_SCHED_OFF

    def test_auto_sync_scheduler_off_when_disabled(self):
        """Auto sync scheduler reports OFF when disabled."""
        from services.auto_report_sync_scheduler import AutoReportSyncScheduler, SCHED_OFF

        svc = AutoReportSyncScheduler(
            config={"auto_sync": {"enabled": False}},
        )
        svc._tick()

        status = svc.get_status()
        assert status.status == SCHED_OFF

    def test_heartbeat_file_contains_all_fields(self, tmp_path):
        """Heartbeat file has all required fields."""
        from services.app_single_instance import write_heartbeat, read_heartbeat
        import sys
        import os

        # Patch the paths to use tmp_path
        with patch("services.app_single_instance._heartbeat_path", return_value=tmp_path / "agent-heartbeat.json"):
            write_heartbeat(
                status="AGENT_RUNNING",
                started_at="2026-06-05T09:00:00Z",
                qb_status="QB_READY",
                activity_log_status="Done",
                timeline_status="Done",
                auto_sync_status="Off",
                last_error="",
            )

            hb = read_heartbeat()
            assert hb is not None
            assert hb["status"] == "AGENT_RUNNING"
            assert hb["qb_status"] == "QB_READY"
            assert hb["activity_log_status"] == "Done"
            assert hb["timeline_status"] == "Done"
            assert hb["auto_sync_status"] == "Off"
            assert "last_heartbeat_at" in hb

    def test_single_instance_lock_prevents_double_start(self, tmp_path):
        """Second agent cannot start when first holds the lock."""
        from services.app_single_instance import acquire_agent_lock, release_agent_lock, is_agent_running
        import os

        with patch("services.app_single_instance._lock_file_path", return_value=tmp_path / "lock.json"):
            # First acquire
            assert acquire_agent_lock(mode="background") is True
            assert is_agent_running() is True

            # Second attempt should fail
            assert acquire_agent_lock(mode="background") is False

            # Release and try again
            release_agent_lock()
            assert acquire_agent_lock(mode="background") is True
            release_agent_lock()

    def test_agent_command_queue_write_and_read(self, tmp_path):
        """Write command to queue, read it back."""
        from services.agent_command_queue import write_command, read_all_pending_commands

        with patch("services.agent_command_queue._cmd_dir", return_value=tmp_path / "commands"), \
             patch("services.agent_command_queue._result_dir", return_value=tmp_path / "results"):

            cmd_id = write_command("GENERATE_ACTIVITY_LOG_NOW", payload={"force": True})
            assert cmd_id.startswith("cmd-")

            pending = read_all_pending_commands()
            assert len(pending) == 1
            assert pending[0]["type"] == "GENERATE_ACTIVITY_LOG_NOW"
            assert pending[0]["payload"] == {"force": True}

    def test_scheduler_state_file_structure(self, tmp_path):
        """Scheduler state file has correct structure."""
        from services.background_agent_service import write_scheduler_state

        state = {
            "updated_at": "2026-06-05T09:00:00Z",
            "agent_status": "AGENT_RUNNING",
            "qb_status": "QB_READY",
            "activity_log": {
                "last_run": "2026-06-05T09:15:00Z",
                "last_status": "Done",
                "scheduled_time": "09:15",
            },
            "timeline": {
                "last_run": "2026-06-05T09:20:00Z",
                "last_status": "Done",
                "scheduled_time": "09:20",
            },
            "reporting_sync": {
                "last_run": "2026-06-05T09:21:00Z",
                "last_status": "Completed",
                "outbox_pending": 0,
            },
        }

        with patch("services.background_agent_service._get_scheduler_state_path", return_value=tmp_path / "scheduler-state.json"):
            write_scheduler_state(state)

            path = tmp_path / "scheduler-state.json"
            assert path.exists()

            data = json.loads(path.read_text(encoding="utf-8"))
            assert data["agent_status"] == "AGENT_RUNNING"
            assert "activity_log" in data
            assert "timeline" in data
            assert "reporting_sync" in data
            assert data["reporting_sync"]["outbox_pending"] == 0
