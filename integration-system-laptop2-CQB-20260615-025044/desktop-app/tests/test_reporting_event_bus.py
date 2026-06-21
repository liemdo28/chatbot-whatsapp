"""tests/test_reporting_event_bus.py"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

# Add desktop-app to path
sys.path.insert(0, str(Path(__file__).parent.parent))


class TestReportingEventBus:
    """Tests for reporting_event_bus.py"""

    @pytest.fixture(autouse=True)
    def setup(self, tmp_path, monkeypatch):
        self.tmp = tmp_path
        self.config_file = self.tmp / "local-config.json"
        self.version_file = self.tmp / "version.json"
        self.events_log = self.tmp / "logs" / "events.jsonl"

        self.version_file.write_text(json.dumps({"app_version": "2.3.0-test"}))
        self.config_file.write_text(json.dumps({
            "machine": {
                "machine_id": "qb-pc-bandera-01",
                "machine_name": "Test PC",
                "store_code": "bandera",
            },
            "agent_coding": {"enabled": True},
        }))

        # Patch the app_paths module so RUNTIME_DIR resolves to tmp_path
        # The bus reads RUNTIME_DIR dynamically via _get_event_log_path
        self.patches = []
        try:
            from services import reporting_event_bus as reb
            reb.RUNTIME_DIR = self.tmp
            # Force re-evaluation of EVENT_LOG
            reb.EVENT_LOG = self.tmp / "logs" / "events.jsonl"
        except ImportError:
            pass

        # Patch machine_identity_service to return test identity
        try:
            from services import machine_identity_service as mis
            mock_identity = MagicMock()
            mock_identity.machine_id = "qb-pc-bandera-01"
            mock_identity.store_code = "bandera"
            monkeypatch.setattr(mis, "get_machine_identity", lambda: mock_identity)
        except ImportError:
            pass

        yield

        for p in self.patches:
            p.stop()

    def _import_bus(self):
        from services import reporting_event_bus as reb
        # Reset the singleton
        reb._instance = None
        # Reset the EVENT_LOG and bus's _event_log
        reb.EVENT_LOG = self.tmp / "logs" / "events.jsonl"
        return reb

    def _mock_identity(self):
        """Create mock identity for tests."""
        mock_id = MagicMock()
        mock_id.machine_id = "qb-pc-bandera-01"
        mock_id.store_code = "bandera"
        return mock_id

    def test_emit_writes_to_jsonl(self):
        """emit() appends a JSON line to events.jsonl."""
        reb = self._import_bus()

        bus = reb.get_bus()
        bus._client = None  # ensure no client
        # Mock _get_machine_info to return test values
        bus._get_machine_info = lambda: ("qb-pc-bandera-01", "bandera")
        
        reb.emit(reb.EventType.BACKGROUND_AGENT_STARTED, status="info")

        assert self.events_log.exists()
        lines = self.events_log.read_text().strip().split("\n")
        assert len(lines) == 1
        record = json.loads(lines[0])
        assert record["event_type"] == "BACKGROUND_AGENT_STARTED"
        assert record["machine_id"] == "qb-pc-bandera-01"
        assert record["store_code"] == "bandera"
        assert "event_id" in record
        assert "created_at" in record

    def test_emit_sends_to_agent_coding_when_client_available(self):
        """emit() calls client._post when AgentCodingClient is available."""
        reb = self._import_bus()

        mock_client = MagicMock()
        mock_client._post.return_value = True
        reb.get_bus()._client = mock_client

        reb.emit(reb.EventType.QB_READY, status="info", payload={"qb_version": "2024"})

        mock_client._post.assert_called_once()
        path, payload = mock_client._post.call_args[0]
        assert path == "/api/qb-agent/event"
        assert payload["event_type"] == "QB_READY"
        assert payload["payload_json"] == '{"qb_version": "2024"}'

    def test_emit_enqueues_to_outbox_when_client_unavailable(self):
        """emit() enqueues to outbox when client is None."""
        reb = self._import_bus()

        bus = reb.get_bus()
        # Set client to None to trigger direct outbox path
        bus._client = None
        # Mock _get_machine_info to return test values
        bus._get_machine_info = lambda: ("qb-pc-bandera-01", "bandera")
        # Also mock _get_client to keep returning None
        bus._get_client = lambda: None

        mock_outbox = MagicMock()
        with patch("services.reporting_outbox.get_outbox", return_value=mock_outbox):
            reb.emit(reb.EventType.QB_BLOCKED, status="error")

            mock_outbox.enqueue.assert_called_once()
            entry = mock_outbox.enqueue.call_args[0][0]
            assert entry["method"] == "POST"
            assert entry["path"] == "/api/qb-agent/event"

    def test_event_id_format(self):
        """event_id follows format: machine_id-EVENT_TYPE-timestamp"""
        reb = self._import_bus()
        bus = reb.get_bus()
        bus._client = None
        # Mock _get_machine_info to return test values  
        bus._get_machine_info = lambda: ("qb-pc-bandera-01", "bandera")

        reb.emit(reb.EventType.ACTIVITY_LOG_COMPLETED)

        lines = self.events_log.read_text().strip().split("\n")
        record = json.loads(lines[0])
        eid = record["event_id"]
        assert eid.startswith("qb-pc-bandera-01-ACTIVITY_LOG_COMPLETED-")
        assert len(eid.split("-")) >= 3

    def test_severity_mapping(self):
        """Each event type maps to correct severity per spec."""
        reb = self._import_bus()
        reb.get_bus()._client = None

        # Test a few mappings
        reb.emit(reb.EventType.QB_WRONG_COMPANY)
        reb.emit(reb.EventType.ACTIVITY_LOG_FAILED)
        reb.emit(reb.EventType.REMOTE_COMMAND_COMPLETED)

        lines = self.events_log.read_text().strip().split("\n")
        records = [json.loads(l) for l in lines]

        # Find by event type
        by_type = {r["event_type"]: r for r in records}
        assert by_type["QB_WRONG_COMPANY"]["severity"] == "warning"
        assert by_type["ACTIVITY_LOG_FAILED"]["severity"] == "error"
        assert by_type["REMOTE_COMMAND_COMPLETED"]["severity"] == "info"

    def test_emit_many_emits_multiple_events(self):
        """emit_many() fires all events in order."""
        reb = self._import_bus()
        reb.get_bus()._client = None

        reb.emit_many([
            (reb.EventType.QB_OPEN_STARTED, "info", {}),
            (reb.EventType.QB_READY, "info", {"company": "Test"}),
            (reb.EventType.BACKGROUND_AGENT_HEARTBEAT, "debug", {}),
        ])

        lines = self.events_log.read_text().strip().split("\n")
        assert len(lines) == 3
        types = [json.loads(l)["event_type"] for l in lines]
        assert types == ["QB_OPEN_STARTED", "QB_READY", "BACKGROUND_AGENT_HEARTBEAT"]

    def test_get_bus_singleton(self):
        """get_bus() returns same instance on repeated calls."""
        reb = self._import_bus()

        bus1 = reb.get_bus()
        bus2 = reb.get_bus()
        assert bus1 is bus2
