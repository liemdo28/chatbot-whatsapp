"""
Tests for services/agent_coding_client.py
"""
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch, Mock
import pytest

# Add desktop-app to path
sys.path.insert(0, str(Path(__file__).parent.parent))


class TestAgentCodingClientHeartbeat:
    """Test heartbeat sending."""

    def test_heartbeat_payload_structure(self):
        """Heartbeat payload contains all required fields."""
        from services.agent_coding_client import AgentCodingClient

        with patch("services.agent_coding_client.get_machine_identity") as mock_id, \
             patch("services.agent_coding_client.get_agent_coding_config") as mock_cfg, \
             patch("services.agent_coding_client.get_api_key") as mock_key, \
             patch("urllib.request.urlopen") as mock_urlopen:

            mock_identity = MagicMock()
            mock_identity.machine_id = "test-machine-01"
            mock_identity.store_code = "test-store"
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
            mock_urlopen.assert_called_once()

            # Verify request was made to correct URL
            call_args = mock_urlopen.call_args
            request = call_args[0][0]
            assert request.full_url == "http://localhost:3456/api/qb-agent/heartbeat"
            assert "Authorization" in request.headers
            assert request.headers["Authorization"] == "Bearer test-api-key"

    def test_heartbeat_offline_enqueues_to_outbox(self):
        """When Agent-Coding is unreachable, heartbeat returns False and enqueues."""
        from services.agent_coding_client import AgentCodingClient

        with patch("services.agent_coding_client.get_machine_identity") as mock_id, \
             patch("services.agent_coding_client.get_agent_coding_config") as mock_cfg, \
             patch("services.agent_coding_client.get_api_key") as mock_key, \
             patch("urllib.request.urlopen") as mock_urlopen, \
             patch("services.agent_coding_client.get_outbox") as mock_outbox_fn:

            mock_identity = MagicMock()
            mock_identity.machine_id = "test-machine-01"
            mock_identity.store_code = "test-store"
            mock_identity.app_version = "v2.3.0"
            mock_id.return_value = mock_identity
            mock_cfg.return_value = {"timeout_seconds": 5}
            mock_key.return_value = "test-api-key"

            import urllib.error
            mock_urlopen.side_effect = urllib.error.URLError("Connection refused")

            mock_outbox = MagicMock()
            mock_outbox_fn.return_value = mock_outbox

            client = AgentCodingClient(base_url="http://localhost:3456")
            result = client.heartbeat(qb_status="QB_READY")

            assert result is False
            mock_outbox.enqueue.assert_called_once()
            enqueued = mock_outbox.enqueue.call_args[0][0]
            assert enqueued["path"] == "/api/qb-agent/heartbeat"
            assert "payload" in enqueued


class TestAgentCodingClientActivityLogResult:
    """Test activity log result posting."""

    def test_activity_log_result_sends_payload(self):
        """activity_log_result sends correct payload to Agent-Coding."""
        from services.agent_coding_client import AgentCodingClient

        with patch("services.agent_coding_client.get_machine_identity") as mock_id, \
             patch("services.agent_coding_client.get_agent_coding_config") as mock_cfg, \
             patch("services.agent_coding_client.get_api_key") as mock_key, \
             patch("urllib.request.urlopen") as mock_urlopen:

            mock_identity = MagicMock()
            mock_identity.machine_id = "test-machine-01"
            mock_identity.store_code = "test-store"
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
                latest_sales_receipt_amount=150.50,
                duration_ms=3500,
            )

            assert result is True
            call_args = mock_urlopen.call_args
            request = call_args[0][0]
            assert request.full_url == "http://localhost:3456/api/qb-agent/activity-log-result"


class TestAgentCodingClientTimelineResult:
    """Test timeline result posting."""

    def test_timeline_result_sends_events(self):
        """timeline_result sends events list to Agent-Coding."""
        from services.agent_coding_client import AgentCodingClient

        with patch("services.agent_coding_client.get_machine_identity") as mock_id, \
             patch("services.agent_coding_client.get_agent_coding_config") as mock_cfg, \
             patch("services.agent_coding_client.get_api_key") as mock_key, \
             patch("urllib.request.urlopen") as mock_urlopen:

            mock_identity = MagicMock()
            mock_identity.machine_id = "test-machine-01"
            mock_identity.store_code = "test-store"
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
            events = [
                {
                    "event_key": "sales_receipt_001",
                    "event_time": "2026-06-04T10:30:00Z",
                    "event_type": "SALES_RECEIPT",
                    "action": "Created",
                    "ref_number": "SR-001",
                    "amount": 250.00,
                    "account": "Checking",
                    "customer": "Toast Sales",
                    "class_name": "Bandera",
                    "source": "QuickBooks",
                }
            ]
            result = client.timeline_result(business_date="2026-06-04", events=events)

            assert result is True
            call_args = mock_urlopen.call_args
            request = call_args[0][0]
            body = json.loads(request.data.decode("utf-8"))
            assert body["business_date"] == "2026-06-04"
            assert len(body["events"]) == 1
            assert body["events"][0]["ref_number"] == "SR-001"


class TestAgentCodingClientSyncResult:
    """Test sync result posting."""

    def test_sync_result_sends_count(self):
        """sync_result sends transaction count and status."""
        from services.agent_coding_client import AgentCodingClient

        with patch("services.agent_coding_client.get_machine_identity") as mock_id, \
             patch("services.agent_coding_client.get_agent_coding_config") as mock_cfg, \
             patch("services.agent_coding_client.get_api_key") as mock_key, \
             patch("urllib.request.urlopen") as mock_urlopen:

            mock_identity = MagicMock()
            mock_identity.machine_id = "test-machine-01"
            mock_identity.store_code = "test-store"
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
                errors=[],
            )

            assert result is True
            call_args = mock_urlopen.call_args
            request = call_args[0][0]
            body = json.loads(request.data.decode("utf-8"))
            assert body["transactions_synced"] == 15
            assert body["status"] == "COMPLETED"


class TestAgentCodingClientPing:
    """Test ping/health check."""

    def test_ping_success(self):
        """ping() returns True on HTTP 200."""
        from services.agent_coding_client import AgentCodingClient

        with patch("services.agent_coding_client.get_machine_identity") as mock_id, \
             patch("services.agent_coding_client.get_agent_coding_config") as mock_cfg, \
             patch("urllib.request.urlopen") as mock_urlopen:

            mock_identity = MagicMock()
            mock_identity.machine_id = "test-machine-01"
            mock_id.return_value = mock_identity
            mock_cfg.return_value = {"timeout_seconds": 5}

            mock_response = MagicMock()
            mock_response.status = 200
            mock_response.__enter__ = MagicMock(return_value=mock_response)
            mock_response.__exit__ = MagicMock(return_value=False)
            mock_urlopen.return_value = mock_response

            client = AgentCodingClient(base_url="http://localhost:3456")
            assert client.ping() is True

    def test_ping_failure_returns_false(self):
        """ping() returns False on connection error."""
        from services.agent_coding_client import AgentCodingClient
        import urllib.error

        with patch("services.agent_coding_client.get_machine_identity") as mock_id, \
             patch("services.agent_coding_client.get_agent_coding_config") as mock_cfg, \
             patch("urllib.request.urlopen") as mock_urlopen:

            mock_identity = MagicMock()
            mock_identity.machine_id = "test-machine-01"
            mock_id.return_value = mock_identity
            mock_cfg.return_value = {"timeout_seconds": 5}

            mock_urlopen.side_effect = urllib.error.URLError("Connection refused")

            client = AgentCodingClient(base_url="http://localhost:3456")
            assert client.ping() is False


class TestAgentCodingClientRegister:
    """Test machine registration."""

    def test_register_sends_payload(self):
        """register() posts the machine registration payload to Agent-Coding."""
        from services.agent_coding_client import AgentCodingClient

        with patch("services.agent_coding_client.get_machine_identity") as mock_id, \
             patch("services.agent_coding_client.get_agent_coding_config") as mock_cfg, \
             patch("services.agent_coding_client.get_api_key") as mock_key, \
             patch("services.machine_identity_service.get_register_payload") as mock_payload, \
             patch("urllib.request.urlopen") as mock_urlopen:

            mock_identity = MagicMock()
            mock_identity.machine_id = "test-machine-01"
            mock_identity.app_version = "v2.3.0"
            mock_id.return_value = mock_identity
            mock_cfg.return_value = {"timeout_seconds": 15}
            mock_key.return_value = "test-api-key"
            mock_payload.return_value = {
                "machine_id": "test-machine-01",
                "store_code": "bandera",
                "capabilities": ["heartbeat"],
            }

            mock_response = MagicMock()
            mock_response.status = 200
            mock_response.__enter__ = MagicMock(return_value=mock_response)
            mock_response.__exit__ = MagicMock(return_value=False)
            mock_urlopen.return_value = mock_response

            client = AgentCodingClient(base_url="http://localhost:3456")
            assert client.register() is True

            request = mock_urlopen.call_args[0][0]
            body = json.loads(request.data.decode("utf-8"))
            assert request.full_url == "http://localhost:3456/api/qb-agent/register"
            assert body["machine_id"] == "test-machine-01"
            assert body["store_code"] == "bandera"
            assert "registered_at" in body
