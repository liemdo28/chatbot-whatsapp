"""Tests for qb_multi_file_sync_scheduler.py."""
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "desktop-app"))

from services.qb_file_registry import QBFileEntry


class TestSchedulerTimingLogic(unittest.TestCase):
    def test_next_cycle_time_is_future(self):
        from services.qb_multi_file_sync_scheduler import _next_cycle_time
        next_t = _next_cycle_time(interval_hours=12, jitter_minutes=0)
        now = datetime.now(timezone.utc)
        self.assertGreater(next_t, now)
        diff = (next_t - now).total_seconds()
        self.assertAlmostEqual(diff, 12 * 3600, delta=5)

    def test_state_persists_after_cycle(self):
        with tempfile.TemporaryDirectory() as tmp:
            state_file = Path(tmp) / "runtime" / "qb-file-sync-state.json"
            state_file.parent.mkdir(parents=True)

            with patch("services.qb_multi_file_sync_scheduler.STATE_FILE", state_file), \
                 patch("services.qb_multi_file_sync_scheduler.get_enabled_files", return_value=[]), \
                 patch("services.qb_multi_file_sync_scheduler._get_config",
                       return_value={"interval_hours": 12, "jitter_minutes": 0}):
                from services.qb_multi_file_sync_scheduler import run_cycle_now
                result = run_cycle_now()

            self.assertIn("cycle_id", result)
            self.assertEqual(result["total_files"], 0)
            state = json.loads(state_file.read_text())
            self.assertIn("last_cycle_started_at", state)
            self.assertIn("next_cycle_at", state)

    def test_one_file_failure_does_not_stop_others(self):
        file_a = QBFileEntry("file-a", "a", "A:\\a.qbw", enabled=True)
        file_b = QBFileEntry("file-b", "b", "B:\\b.qbw", enabled=True)
        call_log = []

        def mock_run(entry, mi_core_client=None, force=False):
            call_log.append(entry.file_id)
            if entry.file_id == "file-a":
                raise RuntimeError("QB exploded")
            return {"file_id": entry.file_id, "status": "PASS",
                    "message": "", "duration_ms": 10, "synced_at": "2026-06-09T10:00:00Z"}

        with tempfile.TemporaryDirectory() as tmp:
            state_file = Path(tmp) / "runtime" / "qb-file-sync-state.json"
            state_file.parent.mkdir(parents=True)

            with patch("services.qb_multi_file_sync_scheduler.STATE_FILE", state_file), \
                 patch("services.qb_multi_file_sync_scheduler.get_enabled_files", return_value=[file_a, file_b]), \
                 patch("services.qb_multi_file_sync_scheduler.run_file_sync", side_effect=mock_run), \
                 patch("services.qb_multi_file_sync_scheduler._get_config",
                       return_value={"interval_hours": 12, "jitter_minutes": 0}):
                from services.qb_multi_file_sync_scheduler import run_cycle_now
                result = run_cycle_now()

        self.assertIn("file-a", call_log)
        self.assertIn("file-b", call_log)
        self.assertEqual(result["total_files"], 2)
        self.assertEqual(result["error_count"], 1)
        self.assertEqual(result["pass_count"], 1)


class TestSchedulerPasswordRequired(unittest.TestCase):
    def test_password_required_counted_as_warning(self):
        entry = QBFileEntry("pw-file", "pw", "D:\\QB\\PW.qbw", enabled=True)

        def mock_run(e, mi_core_client=None, force=False):
            return {
                "file_id": e.file_id,
                "status": "QB_PASSWORD_REQUIRED",
                "message": "Password prompt required",
                "duration_ms": 0,
                "synced_at": "2026-06-09T10:00:00Z",
            }

        with tempfile.TemporaryDirectory() as tmp:
            state_file = Path(tmp) / "runtime" / "qb-file-sync-state.json"
            state_file.parent.mkdir(parents=True)

            with patch("services.qb_multi_file_sync_scheduler.STATE_FILE", state_file), \
                 patch("services.qb_multi_file_sync_scheduler.get_enabled_files", return_value=[entry]), \
                 patch("services.qb_multi_file_sync_scheduler.run_file_sync", side_effect=mock_run), \
                 patch("services.qb_multi_file_sync_scheduler._get_config",
                       return_value={"interval_hours": 12, "jitter_minutes": 0}):
                from services.qb_multi_file_sync_scheduler import run_cycle_now
                result = run_cycle_now()

        self.assertEqual(result["warning_count"], 1)
        self.assertEqual(result["error_count"], 0)


if __name__ == "__main__":
    unittest.main()
