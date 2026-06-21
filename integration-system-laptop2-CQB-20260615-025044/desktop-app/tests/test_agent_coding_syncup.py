"""
Tests for Agent-Coding sync-up (heartbeat, results, offline queue)
"""
import sys
from pathlib import Path
import json
import os
from unittest.mock import MagicMock, patch
import pytest

# Test file is at desktop-app/tests/, so add desktop-app to path
DESKTOP_APP = Path(__file__).resolve().parent.parent
if str(DESKTOP_APP) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP))


class TestAgentCodingSyncUp:
    """Test QB Agent -> Agent-Coding communication."""

    def test_heartbeat_sent_periodically(self, tmp_path):
        """Agent sends heartbeat with all required fields."""
        from services.agent_coding_client import AgentCodingClient

        with patch("services.agent_coding_client.get_machine_identity") as mock_id, \
             patch("services.agent_coding_client.get_agent_coding_config") as mock_cfg, \
             patch("services.agent_coding_client.get_api_key") as mock_key, \
             patch("urllib.request.urlopen") as mock_urlopen:

            mock_identity = MagicMock()
            mock_identity.machine_id = "test-machine-01"
            mock_identity.store_code = "bandera"
            mock_identity.app_version = "v2.3.0"
            mock_id.return_value = mock_identity
            mock_cfg.return_value = {"timeout_seconds": 15}
            mock_key.return_value = "test-api-key"

            mock_response = MagicMock()
            mock_response.status = 200
            mock_response.__enter__ = MagicMock(return_value=mock_response)
            mock_response.__exit__ = MagicMock(return_value=False)
            mock_urlopen.return_value = mock_response

            client = AgentCodingClient(base_url="http://localhost:3456")
            result = client.heartbeat(
                qb_status="QB_READY",
                agent_status="running",
                activity_log_status="Done",
                timeline_status="Done",
                auto_sync_status="Off",
                last_error="",
            )

            assert result is True
            call_args = mock_urlopen.call_args
            request = call_args[0][0]
            assert "/api/qb-agent/heartbeat" in request.full_url

    def test_heartbeat_offline_queues_to_outbox(self, tmp_path):
        """When Agent-Coding unreachable, heartbeat goes to outbox."""
        from services.agent_coding_client import AgentCodingClient
        import urllib.error

        with patch("services.agent_coding_client.get_machine_identity") as mock_id, \
             patch("services.agent_coding_client.get_agent_coding_config") as mock_cfg, \
             patch("services.agent_coding_client.get_api_key") as mock_key, \
             patch("urllib.request.urlopen") as mock_urlopen, \
             patch("services.agent_coding_client.get_outbox") as mock_outbox_fn:

            mock_identity = MagicMock()
            mock_identity.machine_id = "test-machine-01"
            mock_identity.store_code = "bandera"
            mock_identity.app_version = "v2.3.0"
            mock_id.return_value = mock_identity
            mock_cfg.return_value = {"timeout_seconds": 5}
            mock_key.return_value = "test-api-key"

            mock_urlopen.side_effect = urllib.error.URLError("Connection refused")

            mock_outbox = MagicMock()
            mock_outbox_fn.return_value = mock_outbox

            client = AgentCodingClient(base_url="http://localhost:3456")
            result = client.heartbeat(qb_status="QB_READY")

            assert result is False
            mock_outbox.enqueue.assert_called_once()

    def test_activity_log_result_sent(self):
        """Activity log result posted to Agent-Coding."""
        from services.agent_coding_client import AgentCodingClient

        with patch("services.agent_coding_client.get_machine_identity") as mock_id, \
             patch("services.agent_coding_client.get_agent_coding_config") as mock_cfg, \
             patch("services.agent_coding_client.get_api_key") as mock_key, \
             patch("urllib.request.urlopen") as mock_urlopen:

            mock_identity = MagicMock()
            mock_identity.machine_id = "test-machine-01"
            mock_identity.store_code = "bandera"
            mock_identity.app_version = "v2.3.0"
            mock_id.return_value = mock_identity
            mock_cfg.return_value = {"timeout_seconds": 15}
            mock_key.return_value = "test-api-key"

            mock_response = MagicMock()
            mock_response.status = 200
            mock_response.__enter__ = MagicMock(return_value=mock_response)
            mock_response.__exit__ = MagicMock(return_value=False)
            mock_urlopen.return_value = mock_response

            client = AgentCodingClient(base_url="http://localhost:3456")
            result = client.activity_log_result(
                business_date="2026-06-04",
                status="PASS",
                latest_sales_receipt_date="2026-06-04",
                latest_sales_receipt_ref="SR-001",
                duration_ms=3500,
            )

            assert result is True
            call_args = mock_urlopen.call_args
            request = call_args[0][0]
            assert "/api/qb-agent/activity-log-result" in request.full_url

    def test_timeline_result_sent(self):
        """Timeline result posted to Agent-Coding."""
        from services.agent_coding_client import AgentCodingClient

        with patch("services.agent_coding_client.get_machine_identity") as mock_id, \
             patch("services.agent_coding_client.get_agent_coding_config") as mock_cfg, \
             patch("services.agent_coding_client.get_api_key") as mock_key, \
             patch("urllib.request.urlopen") as mock_urlopen:

            mock_identity = MagicMock()
            mock_identity.machine_id = "test-machine-01"
            mock_identity.store_code = "bandera"
            mock_identity.app_version = "v2.3.0"
            mock_id.return_value = mock_identity
            mock_cfg.return_value = {"timeout_seconds": 15}
            mock_key.return_value = "test-api-key"

            mock_response = MagicMock()
            mock_response.status = 200
            mock_response.__enter__ = MagicMock(return_value=mock_response)
            mock_response.__exit__ = MagicMock(return_value=False)
            mock_urlopen.return_value = mock_response

            client = AgentCodingClient(base_url="http://localhost:3456")
            events = [{"event_key": "sr-001", "event_time": "2026-06-04T10:00:00Z", "event_type": "SALES_RECEIPT", "ref_number": "SR-001", "amount": 100.0}]
            result = client.timeline_result(business_date="2026-06-04", events=events)

            assert result is True
            call_args = mock_urlopen.call_args
            request = call_args[0][0]
            assert "/api/qb-agent/timeline-result" in request.full_url

    def test_sync_result_sent(self):
        """Sync result posted to Agent-Coding."""
        from services.agent_coding_client import AgentCodingClient

        with patch("services.agent_coding_client.get_machine_identity") as mock_id, \
             patch("services.agent_coding_client.get_agent_coding_config") as mock_cfg, \
             patch("services.agent_coding_client.get_api_key") as mock_key, \
             patch("urllib.request.urlopen") as mock_urlopen:

            mock_identity = MagicMock()
            mock_identity.machine_id = "test-machine-01"
            mock_identity.store_code = "bandera"
            mock_identity.app_version = "v2.3.0"
            mock_id.return_value = mock_identity
            mock_cfg.return_value = {"timeout_seconds": 15}
            mock_key.return_value = "test-api-key"

            mock_response = MagicMock()
            mock_response.status = 200
            mock_response.__enter__ = MagicMock(return_value=mock_response)
            mock_response.__exit__ = MagicMock(return_value=False)
            mock_urlopen.return_value = mock_response

            client = AgentCodingClient(base_url="http://localhost:3456")
            result = client.sync_result(
                business_date="2026-06-04",
                status="COMPLETED",
                transactions_synced=15,
            )

            assert result is True
            call_args = mock_urlopen.call_args
            request = call_args[0][0]
            assert "/api/qb-agent/sync-result" in request.full_url

    def test_error_report_sent(self):
        """Error event posted to Agent-Coding."""
        from services.agent_coding_client import AgentCodingClient

        with patch("services.agent_coding_client.get_machine_identity") as mock_id, \
             patch("services.agent_coding_client.get_agent_coding_config") as mock_cfg, \
             patch("services.agent_coding_client.get_api_key") as mock_key, \
             patch("urllib.request.urlopen") as mock_urlopen:

            mock_identity = MagicMock()
            mock_identity.machine_id = "test-machine-01"
            mock_identity.store_code = "bandera"
            mock_identity.app_version = "v2.3.0"
            mock_id.return_value = mock_identity
            mock_cfg.return_value = {"timeout_seconds": 15}
            mock_key.return_value = "test-api-key"

            mock_response = MagicMock()
            mock_response.status = 200
            mock_response.__enter__ = MagicMock(return_value=mock_response)
            mock_response.__exit__ = MagicMock(return_value=False)
            mock_urlopen.return_value = mock_response

            client = AgentCodingClient(base_url="http://localhost:3456")
            result = client.error_report(
                severity="error",
                component="QB_STARTUP",
                message="QuickBooks exe not found",
                exception="FileNotFoundError",
            )

            assert result is True
            call_args = mock_urlopen.call_args
            request = call_args[0][0]
            assert "/api/qb-agent/error" in request.full_url

    def test_event_sent_via_event_bus(self):
        """Lifecycle events go through event bus to Agent-Coding."""
        from services.reporting_event_bus import emit, EventType

        with patch("services.reporting_event_bus.get_bus") as mock_bus_fn:
            mock_bus = MagicMock()
            mock_bus_fn.return_value = mock_bus
            emit(EventType.BACKGROUND_AGENT_STARTED, status="info", payload={"machine_id": "test-01"})
            mock_bus.emit.assert_called_once_with(EventType.BACKGROUND_AGENT_STARTED, status="info", payload={"machine_id": "test-01"})


class TestOutboxRetry:
    """Test offline queue flush on reconnect."""

    def test_outbox_enqueue_creates_file(self, tmp_path):
        """enqueue() writes JSON file to reporting-outbox/."""
        from services.reporting_outbox import ReportingOutbox

        outbox = ReportingOutbox(outbox_dir=tmp_path)
        filename = outbox.enqueue({"method": "POST", "path": "/api/qb-agent/heartbeat", "payload": {}})
        assert (tmp_path / filename).exists()

    def test_outbox_flush_sends_all_pending(self, tmp_path):
        """flush() posts all pending entries."""
        from services.reporting_outbox import ReportingOutbox

        outbox = ReportingOutbox(outbox_dir=tmp_path)
        outbox.enqueue({"method": "POST", "path": "/api/qb-agent/heartbeat", "payload": {}})
        outbox.enqueue({"method": "POST", "path": "/api/qb-agent/activity-log-result", "payload": {}})

        mock_client = MagicMock()
        mock_client._post.return_value = True

        sent, failed = outbox.flush(client=mock_client)
        assert sent == 2
        assert failed == 0

    def test_outbox_flush_keeps_failed_entries(self, tmp_path):
        """Failed entries remain in outbox."""
        from services.reporting_outbox import ReportingOutbox

        outbox = ReportingOutbox(outbox_dir=tmp_path)
        outbox.enqueue({"method": "POST", "path": "/api/qb-agent/heartbeat", "payload": {}})

        mock_client = MagicMock()
        mock_client._post.return_value = False

        sent, failed = outbox.flush(client=mock_client)
        assert sent == 0
        assert failed == 1
        assert outbox.count() == 1

    def test_outbox_prune_removes_old_entries(self, tmp_path):
        """prune() removes entries older than MAX_AGE_DAYS."""
        import time
        from services.reporting_outbox import ReportingOutbox

        outbox = ReportingOutbox(outbox_dir=tmp_path, max_age_days=1)
        outbox.enqueue({"method": "POST", "path": "/test", "payload": {}})

        # Create an old file and set its mtime to 31 days ago
        old_file = tmp_path / f"old_{int(time.time()) - 86400 * 31}.json"
        old_file.write_text(json.dumps({"method": "POST", "path": "/old"}), encoding="utf-8")
        old_time = time.time() - 86400 * 31
        os.utime(old_file, (old_time, old_time))

        removed = outbox.prune()
        assert removed >= 1

    def test_outbox_enforces_max_pending(self, tmp_path):
        """prune() removes oldest when over MAX_PENDING."""
        from services.reporting_outbox import ReportingOutbox

        outbox = ReportingOutbox(outbox_dir=tmp_path, max_pending=3, max_age_days=365)
        for i in range(5):
            outbox.enqueue({"method": "POST", "path": f"/test{i}", "payload": {}})

        assert outbox.count() == 5
        removed = outbox.prune()
        assert removed == 2
        assert outbox.count() == 3