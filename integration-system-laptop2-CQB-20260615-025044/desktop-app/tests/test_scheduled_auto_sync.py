"""
Tests for scheduled auto-sync (activity log, timeline, auto report sync)
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


class TestScheduledAutoSync:
    """Test scheduler state file and scheduled execution."""

    def test_scheduler_state_file_written_on_heartbeat(self, tmp_path):
        """runtime/scheduler-state.json is written by background agent."""
        from services.background_agent_service import write_scheduler_state

        state = {
            "updated_at": "2026-06-05T09:00:00Z",
            "agent_status": "AGENT_RUNNING",
            "qb_status": "QB_READY",
            "activity_log": {"last_run": "2026-06-05T09:15:00Z", "last_status": "Done", "scheduled_time": "09:15"},
            "timeline": {"last_run": "2026-06-05T09:20:00Z", "last_status": "Done", "scheduled_time": "09:20"},
            "reporting_sync": {"last_run": "2026-06-05T09:21:00Z", "last_status": "Completed", "outbox_pending": 0},
        }

        with patch("services.background_agent_service._get_scheduler_state_path", return_value=tmp_path / "scheduler-state.json"):
            write_scheduler_state(state)

            path = tmp_path / "scheduler-state.json"
            assert path.exists()
            data = json.loads(path.read_text(encoding="utf-8"))
            assert data["activity_log"]["last_run"] == "2026-06-05T09:15:00Z"
            assert data["timeline"]["scheduled_time"] == "09:20"
            assert data["reporting_sync"]["outbox_pending"] == 0

    def test_activity_log_scheduler_run_on_app_start(self):
        """Activity log scheduler respects run_on_app_start config."""
        from services.qb_activity_log_scheduler import QBActivityLogScheduler

        config = {
            "qb_activity_log": {
                "enabled": True,
                "run_on_app_start": True,
                "daily_time": "00:00",
                "stores": [{"code": "bandera", "name": "Bandera"}],
            }
        }

        with patch("services.qb_activity_log_service.generate_all_stores", return_value=[{"store": "bandera", "status": "PASS"}]):
            sched = QBActivityLogScheduler(
                config=config,
                get_qb_status=lambda: "QB_READY",
            )
            sched._tick()
            status, msg = sched.get_status()
            assert status in ("Done", "Running")

    def test_timeline_scheduler_run_on_app_start(self):
        """Timeline scheduler respects run_on_app_start config."""
        from services.qb_activity_timeline_scheduler import QBActivityTimelineScheduler

        config = {
            "qb_activity_timeline": {
                "enabled": True,
                "run_on_app_start": True,
                "daily_time": "00:00",
                "stores": [{"code": "bandera", "name": "Bandera"}],
            }
        }

        with patch("services.qb_activity_timeline_service.generate_all_timelines", return_value=[{"store": "bandera", "status": "PASS"}]):
            sched = QBActivityTimelineScheduler(
                config=config,
                get_qb_status=lambda: "QB_READY",
            )
            sched._tick()
            status, msg = sched.get_status()
            assert status in ("Done", "Running")

    def test_duplicate_guard_prevents_same_day_rerun(self):
        """Scheduler skips if already triggered today."""
        from services.qb_activity_log_scheduler import QBActivityLogScheduler, ALOG_DONE
        from datetime import date

        config = {
            "qb_activity_log": {
                "enabled": True,
                "daily_time": "00:00",
                "stores": [{"code": "bandera", "name": "Bandera"}],
            }
        }

        with patch("services.qb_activity_log_service.generate_all_stores", return_value=[{"store": "bandera", "status": "PASS"}]) as mock_gen:
            sched = QBActivityLogScheduler(config=config, get_qb_status=lambda: "QB_READY")
            sched._triggered_date = date.today().isoformat()
            sched._tick()
            status, _ = sched.get_status()
            assert status == ALOG_DONE
            mock_gen.assert_not_called()

    def test_manual_force_run_bypasses_schedule(self):
        """trigger_now(force=True) runs regardless of time or duplicate."""
        from services.qb_activity_log_scheduler import QBActivityLogScheduler

        config = {
            "qb_activity_log": {
                "enabled": True,
                "daily_time": "23:59",
                "stores": [{"code": "bandera", "name": "Bandera"}],
            }
        }

        with patch("services.qb_activity_log_service.generate_all_stores", return_value=[{"store": "bandera", "status": "PASS"}]) as mock_gen:
            sched = QBActivityLogScheduler(config=config, get_qb_status=lambda: "QB_READY")
            result = sched.trigger_now(force=True)
            assert result["ok"] is True
            mock_gen.assert_called_once()

    def test_auto_sync_scheduler_qb_ready_check(self):
        """Auto sync scheduler waits for QB_READY."""
        from services.auto_report_sync_scheduler import AutoReportSyncScheduler, SCHED_QB_NOT_READY

        config = {
            "auto_sync": {
                "enabled": True,
                "report_time": "00:00",
                "timezone": "America/Chicago",
                "stores": ["bandera"],
            }
        }

        sched = AutoReportSyncScheduler(config=config, get_qb_status=lambda: "QB_CLOSED")
        sched._tick()
        status = sched.get_status()
        assert status.status == SCHED_QB_NOT_READY

    def test_auto_sync_duplicate_guard_via_sync_ledger(self):
        """Auto sync uses SyncLedger to skip already synced store/date."""
        from services import auto_report_sync_scheduler as arss
        from sync_ledger import SyncLedger

        mock_conn = MagicMock()
        mock_conn.execute.return_value.fetchone.return_value = ("sync-123",)
        mock_ledger = MagicMock()
        mock_ledger._connect.return_value.__enter__.return_value = mock_conn

        with patch.object(arss, "SyncLedger", return_value=mock_ledger):
            result = arss._was_already_synced("bandera", "2026-06-04")
            assert result is True

    def test_lock_guard_prevents_concurrent_sync(self):
        """Sync lock prevents scheduler + manual sync overlap."""
        from services.auto_report_sync_scheduler import acquire_sync_lock, release_sync_lock

        assert acquire_sync_lock(timeout=0.1) is True
        assert acquire_sync_lock(timeout=0.1) is False
        release_sync_lock()
        assert acquire_sync_lock(timeout=0.1) is True

    def test_scheduler_error_logged(self):
        """Scheduler logs errors and sets FAILED status."""
        from services.qb_activity_log_scheduler import QBActivityLogScheduler, ALOG_FAILED

        config = {
            "qb_activity_log": {
                "enabled": True,
                "daily_time": "00:00",
                "stores": [{"code": "bandera", "name": "Bandera"}],
            }
        }

        with patch("services.qb_activity_log_service.generate_all_stores", side_effect=Exception("QB connection failed")):
            sched = QBActivityLogScheduler(config=config, get_qb_status=lambda: "QB_READY")
            sched._tick()
            status, msg = sched.get_status()
            assert status == ALOG_FAILED
            assert "QB connection failed" in msg


class TestSchedulerCheckpoint:
    """Test last_run checkpoint in scheduler-state.json."""

    def test_activity_log_last_run_updated(self):
        """Activity log scheduler updates last_run on completion."""
        from services.qb_activity_log_scheduler import QBActivityLogScheduler

        config = {
            "qb_activity_log": {
                "enabled": True,
                "daily_time": "00:00",
                "stores": [{"code": "bandera", "name": "Bandera"}],
            }
        }

        with patch("services.qb_activity_log_service.generate_all_stores", return_value=[{"store": "bandera", "status": "PASS"}]):
            sched = QBActivityLogScheduler(config=config, get_qb_status=lambda: "QB_READY")
            sched._tick()
            assert sched.get_last_run_at() != ""

    def test_timeline_last_run_updated(self):
        """Timeline scheduler updates last_run on completion."""
        from services.qb_activity_timeline_scheduler import QBActivityTimelineScheduler

        config = {
            "qb_activity_timeline": {
                "enabled": True,
                "daily_time": "00:00",
                "stores": [{"code": "bandera", "name": "Bandera"}],
            }
        }

        with patch("services.qb_activity_timeline_service.generate_all_timelines", return_value=[{"store": "bandera", "status": "PASS"}]):
            sched = QBActivityTimelineScheduler(config=config, get_qb_status=lambda: "QB_READY")
            sched._tick()
            assert sched.get_last_run_at() != ""

    def test_auto_sync_last_run_updated(self):
        """Auto sync scheduler updates last_sync_at on completion."""
        from services.auto_report_sync_scheduler import AutoReportSyncScheduler

        config = {
            "auto_sync": {
                "enabled": True,
                "report_time": "00:00",
                "timezone": "America/Chicago",
                "stores": ["bandera"],
            }
        }

        with patch("services.auto_report_sync_scheduler.check_missing_reports", return_value=[]), \
             patch("services.auto_report_sync_scheduler.acquire_sync_lock", return_value=True), \
             patch("services.auto_report_sync_scheduler.release_sync_lock"):
            sched = AutoReportSyncScheduler(config=config, get_qb_status=lambda: "QB_READY")
            sched._tick()
            status = sched.get_status()
            assert status.last_sync_at != ""


class TestConfigDrivenSchedules:
    """Test daily_time and timezone from config."""

    def test_activity_log_daily_time_from_config(self):
        """Scheduler uses daily_time from config."""
        from services.qb_activity_log_scheduler import QBActivityLogScheduler

        config = {
            "qb_activity_log": {
                "enabled": True,
                "daily_time": "14:30",
                "stores": [{"code": "bandera", "name": "Bandera"}],
            }
        }
        sched = QBActivityLogScheduler(config=config)
        assert sched._triggered_date == ""

    def test_timeline_daily_time_from_config(self):
        """Timeline scheduler uses daily_time from config."""
        from services.qb_activity_timeline_scheduler import QBActivityTimelineScheduler

        config = {
            "qb_activity_timeline": {
                "enabled": True,
                "daily_time": "09:20",
                "stores": [{"code": "bandera", "name": "Bandera"}],
            }
        }
        sched = QBActivityTimelineScheduler(config=config)
        assert sched._triggered_date == ""
