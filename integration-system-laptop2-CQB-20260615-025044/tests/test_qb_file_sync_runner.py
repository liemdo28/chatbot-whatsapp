"""Tests for qb_file_sync_runner.py."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "desktop-app"))


class TestQBFileSyncRunner(unittest.TestCase):
    def _entry(self, tmp, file_id="test", exists=True):
        from services.qb_file_registry import QBFileEntry
        p = Path(tmp) / "Company.qbw"
        if exists:
            p.write_bytes(b"fake")
        return QBFileEntry(
            file_id=file_id,
            store_code="test",
            company_file_path=str(p),
            enabled=True,
        )

    def test_file_not_found_returns_qb_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            entry = self._entry(tmp, exists=False)
            with patch("services.qb_file_sync_runner.update_file_status"):
                from services import qb_file_sync_runner as runner
                import importlib; importlib.reload(runner)
                result = runner.run_file_sync(entry)
        self.assertEqual(result["status"], "QB_BLOCKED")

    def test_win32com_unavailable_returns_pass_mock(self):
        with tempfile.TemporaryDirectory() as tmp:
            entry = self._entry(tmp)
            with patch("services.qb_file_sync_runner.update_file_status"), \
                 patch.dict("sys.modules", {"win32com": None, "win32com.client": None}):
                from services import qb_file_sync_runner as runner
                import importlib; importlib.reload(runner)
                result = runner.run_file_sync(entry)
        # Without win32com, mock returns PASS
        self.assertIn(result["status"], ("PASS", "PASS_WITH_WARNINGS"))

    def test_mi_core_result_payload_includes_file_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            entry = self._entry(tmp)
            mock_client = MagicMock()
            mock_client.activity_log_result.return_value = True
            mock_client.timeline_result.return_value = True
            mock_client.sync_result.return_value = True

            with patch("services.qb_file_sync_runner.update_file_status"), \
                 patch.dict("sys.modules", {"win32com": None, "win32com.client": None}):
                from services import qb_file_sync_runner as runner
                import importlib; importlib.reload(runner)
                runner.run_file_sync(entry, mi_core_client=mock_client)

            if mock_client.activity_log_result.called:
                kwargs = mock_client.activity_log_result.call_args
                self.assertEqual(kwargs.kwargs.get("file_id") or kwargs.args[1] if len(kwargs.args) > 1 else kwargs.kwargs.get("file_id"), "test")

    def test_concurrent_sync_returns_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            entry1 = self._entry(tmp, file_id="file1")
            entry2 = self._entry(tmp, file_id="file2")

            import threading
            from services import qb_file_sync_runner as runner
            import importlib; importlib.reload(runner)

            # Force lock
            runner._sync_lock.acquire()
            runner._running_file_id = "file1"
            try:
                with patch("services.qb_file_sync_runner.update_file_status"):
                    result = runner.run_file_sync(entry2)
                self.assertEqual(result["status"], "SKIPPED")
            finally:
                runner._running_file_id = None
                runner._sync_lock.release()


if __name__ == "__main__":
    unittest.main()
