"""
Tests for services/reporting_outbox.py
"""
import json
import os
import time
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch
import pytest

# Add desktop-app to path
sys.path.insert(0, str(Path(__file__).parent.parent))


class TestReportingOutboxEnqueue:
    """Test outbox enqueue."""

    def test_enqueue_writes_json_file(self, tmp_path):
        """enqueue() creates a JSON file in the outbox directory."""
        from services.reporting_outbox import ReportingOutbox

        outbox = ReportingOutbox(outbox_dir=tmp_path)
        entry = {
            "method": "POST",
            "path": "/api/qb-agent/heartbeat",
            "payload": {"machine_id": "test-01", "qb_status": "QB_READY"},
            "attempted_at": "2026-06-05T09:00:00Z",
        }

        filename = outbox.enqueue(entry)

        assert filename.endswith(".json")
        assert (tmp_path / filename).exists()

        # Verify content
        with open(tmp_path / filename) as f:
            data = json.load(f)
        assert data["method"] == "POST"
        assert data["path"] == "/api/qb-agent/heartbeat"

    def test_enqueue_returns_filename(self, tmp_path):
        """enqueue() returns the filename."""
        from services.reporting_outbox import ReportingOutbox

        outbox = ReportingOutbox(outbox_dir=tmp_path)
        result = outbox.enqueue({"method": "POST", "path": "/test"})
        assert isinstance(result, str)
        assert result.endswith(".json")


class TestReportingOutboxFlush:
    """Test outbox flush/retry."""

    def test_flush_sends_pending_entries(self, tmp_path):
        """flush() sends all pending entries via POST."""
        from services.reporting_outbox import ReportingOutbox

        outbox = ReportingOutbox(outbox_dir=tmp_path, retry_interval=300)

        # Enqueue two entries
        outbox.enqueue({"method": "POST", "path": "/api/qb-agent/heartbeat", "payload": {}})
        outbox.enqueue({"method": "POST", "path": "/api/qb-agent/activity-log-result", "payload": {}})

        # Mock client that succeeds
        mock_client = MagicMock()
        mock_client._post.return_value = True

        sent, failed = outbox.flush(client=mock_client)

        assert sent == 2
        assert failed == 0
        assert mock_client._post.call_count == 2

    def test_flush_removes_confirmed_entries(self, tmp_path):
        """flush() removes entries that were successfully sent."""
        from services.reporting_outbox import ReportingOutbox

        outbox = ReportingOutbox(outbox_dir=tmp_path)
        outbox.enqueue({"method": "POST", "path": "/api/qb-agent/heartbeat", "payload": {}})

        mock_client = MagicMock()
        mock_client._post.return_value = True

        outbox.flush(client=mock_client)

        # File should be removed
        assert outbox.count() == 0

    def test_flush_keeps_failed_entries(self, tmp_path):
        """flush() keeps entries that failed to send."""
        from services.reporting_outbox import ReportingOutbox

        outbox = ReportingOutbox(outbox_dir=tmp_path)
        outbox.enqueue({"method": "POST", "path": "/api/qb-agent/heartbeat", "payload": {}})

        mock_client = MagicMock()
        mock_client._post.return_value = False

        sent, failed = outbox.flush(client=mock_client)

        assert sent == 0
        assert failed == 1
        assert outbox.count() == 1  # Still pending

    def test_flush_empty_returns_zero(self, tmp_path):
        """flush() on empty outbox returns (0, 0)."""
        from services.reporting_outbox import ReportingOutbox

        outbox = ReportingOutbox(outbox_dir=tmp_path)
        sent, failed = outbox.flush()
        assert sent == 0
        assert failed == 0


class TestReportingOutboxPrune:
    """Test outbox prune."""

    def test_prune_removes_old_entries(self, tmp_path):
        """prune() removes entries older than MAX_AGE_DAYS."""
        from services.reporting_outbox import ReportingOutbox

        # Use short max age for testing (1 day)
        outbox = ReportingOutbox(outbox_dir=tmp_path, max_age_days=1)

        outbox.enqueue({"method": "POST", "path": "/test", "payload": {}})

        # Create an old file and set its mtime to 31 days ago
        old_file = tmp_path / f"old_entry_{int(time.time())-86400*31}.json"
        old_file.write_text(json.dumps({"method": "POST", "path": "/old"}), encoding="utf-8")
        old_time = time.time() - 86400 * 31
        os.utime(old_file, (old_time, old_time))

        removed = outbox.prune()

        assert removed >= 1  # At least the old file removed
        assert outbox.count() <= 1

    def test_prune_enforces_max_pending(self, tmp_path):
        """prune() removes oldest when over MAX_PENDING limit."""
        from services.reporting_outbox import ReportingOutbox

        # Create outbox with max_pending=3
        outbox = ReportingOutbox(outbox_dir=tmp_path, max_pending=3, max_age_days=365)

        # Enqueue 5 entries (over the 3 limit)
        for i in range(5):
            outbox.enqueue({"method": "POST", "path": f"/test{i}", "payload": {}})

        assert outbox.count() == 5  # Before prune

        removed = outbox.prune()

        assert removed == 2  # 2 excess removed
        assert outbox.count() == 3  # Now at max_pending


class TestReportingOutboxWorker:
    """Test background worker thread."""

    def test_start_worker_creates_thread(self, tmp_path):
        """start_worker() starts a daemon thread."""
        from services.reporting_outbox import ReportingOutbox

        outbox = ReportingOutbox(outbox_dir=tmp_path)
        outbox.start_worker()

        assert outbox._worker is not None
        assert outbox._worker.is_alive() is True

        outbox.stop_worker()

    def test_stop_worker_stops_thread(self, tmp_path):
        """stop_worker() stops the worker thread."""
        from services.reporting_outbox import ReportingOutbox

        outbox = ReportingOutbox(outbox_dir=tmp_path)
        outbox.start_worker()
        outbox.stop_worker()

        assert outbox._worker.join(timeout=5) is None  # join() returns None


class TestReportingOutboxSummary:
    """Test diagnostic summary."""

    def test_summary_returns_pending_count(self, tmp_path):
        """summary() returns total_pending count."""
        from services.reporting_outbox import ReportingOutbox

        outbox = ReportingOutbox(outbox_dir=tmp_path)
        outbox.enqueue({"method": "POST", "path": "/test1", "payload": {}})
        outbox.enqueue({"method": "POST", "path": "/test2", "payload": {}})

        summary = outbox.summary()

        assert summary["total_pending"] == 2
        assert summary["outbox_dir"] == str(tmp_path)
        assert "age_distribution" in summary
