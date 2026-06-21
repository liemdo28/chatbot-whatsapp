"""tests/test_machine_identity_service.py"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

# Add services dir to path for direct import
sys.path.insert(0, str(Path(__file__).parent.parent / "services"))


class TestMachineIdentityService:
    """Tests for machine_identity_service.py"""

    @pytest.fixture(autouse=True)
    def setup(self, tmp_path, monkeypatch):
        self.tmp = tmp_path
        self.config_file = self.tmp / "local-config.json"
        self.version_file = self.tmp / "version.json"
        self.version_file.write_text(json.dumps({"app_version": "2.3.0-test"}))

        # Add desktop-app to path for app_paths import
        sys.path.insert(0, str(Path(__file__).parent.parent))

        # Patch the module's RUNTIME_DIR and LOCAL_CONFIG_PATH at module level
        import machine_identity_service as mis
        monkeypatch.setattr(mis, "RUNTIME_DIR", self.tmp)
        monkeypatch.setattr(mis, "LOCAL_CONFIG_PATH", self.config_file)
        # Also patch get_api_key to return our test key
        monkeypatch.setattr(mis, "get_api_key", lambda: os.environ.get("AGENT_CODING_API_KEY", ""))
        # Patch app_paths.RUNTIME_DIR too
        import app_paths
        monkeypatch.setattr(app_paths, "RUNTIME_DIR", self.tmp)

        yield

    def write_config(self, config: dict) -> None:
        self.config_file.write_text(json.dumps(config), encoding="utf-8")

    def test_unconfigured_machine_id_auto_generated(self):
        """When machine.machine_id is absent, auto-generate one."""
        self.write_config({})
        # Force reload
        import importlib
        import machine_identity_service as mis
        importlib.reload(mis)

        identity = mis.get_machine_identity()
        assert identity.machine_id.startswith("auto-")
        assert identity.store_code == "unknown"
        assert identity.is_configured is False

    def test_configured_identity_parsed_correctly(self):
        """Full machine section is parsed into MachineIdentity."""
        self.write_config({
            "machine": {
                "machine_id": "qb-pc-bandera-01",
                "machine_name": "Bandera QB PC",
                "store_code": "bandera",
                "store_name": "Bakudan Bandera",
                "location": "Bandera",
            },
            "agent_coding": {"enabled": True},
        })
        os.environ["AGENT_CODING_API_KEY"] = "test-key-123"

        import importlib
        import machine_identity_service as mis
        importlib.reload(mis)

        identity = mis.get_machine_identity()
        assert identity.machine_id == "qb-pc-bandera-01"
        assert identity.machine_name == "Bandera QB PC"
        assert identity.store_code == "bandera"
        assert identity.is_configured is True

    def test_validate_identity_rejects_disabled(self):
        """Validation fails when agent_coding.enabled is False."""
        self.write_config({
            "machine": {"machine_id": "test-01", "store_code": "test"},
            "agent_coding": {"enabled": False},
        })
        os.environ["AGENT_CODING_API_KEY"] = "test-key"
        import importlib
        import machine_identity_service as mis
        importlib.reload(mis)

        ok, msg = mis.validate_identity()
        assert ok is False
        assert "enabled is False" in msg

    def test_validate_identity_rejects_missing_api_key(self):
        """Validation fails when AGENT_CODING_API_KEY is not set."""
        self.write_config({
            "machine": {"machine_id": "test-01", "store_code": "test"},
            "agent_coding": {"enabled": True},
        })
        os.environ.pop("AGENT_CODING_API_KEY", None)
        os.environ.pop("MI_CORE_API_KEY", None)
        import importlib
        import machine_identity_service as mis
        importlib.reload(mis)

        ok, msg = mis.validate_identity()
        assert ok is False
        assert "not set" in msg

    def test_validate_identity_passes_when_configured(self):
        """Validation succeeds when machine_id + enabled + api_key all present."""
        self.write_config({
            "machine": {"machine_id": "test-01", "store_code": "test"},
            "agent_coding": {"enabled": True},
        })
        os.environ["AGENT_CODING_API_KEY"] = "valid-key"
        import importlib
        import machine_identity_service as mis
        importlib.reload(mis)

        ok, msg = mis.validate_identity()
        assert ok is True
        assert msg == ""

    def test_get_register_payload_contains_required_fields(self):
        """Registration payload has all required fields per spec."""
        self.write_config({
            "machine": {
                "machine_id": "test-machine",
                "machine_name": "Test PC",
                "store_code": "test-store",
                "store_name": "Test Store",
                "location": "Test Location",
            },
            "agent_coding": {"enabled": True, "base_url": "http://example.com:3456"},
        })
        os.environ["AGENT_CODING_API_KEY"] = "key"
        import importlib
        import machine_identity_service as mis
        importlib.reload(mis)

        payload = mis.get_register_payload()
        assert payload["machine_id"] == "test-machine"
        assert payload["store_code"] == "test-store"
        assert "capabilities" in payload
        assert "registered_at" in payload
        assert "heartbeat" in payload["capabilities"]
        assert "command_ack" in payload["capabilities"]

    def test_machine_identity_to_headers(self):
        """to_headers() returns required HTTP headers."""
        self.write_config({
            "machine": {"machine_id": "test-01", "store_code": "test"},
            "agent_coding": {"enabled": True},
        })
        os.environ.pop("MI_CORE_API_KEY", None)
        os.environ["AGENT_CODING_API_KEY"] = "secret-key"
        import importlib
        import machine_identity_service as mis
        importlib.reload(mis)

        identity = mis.get_machine_identity()
        headers = identity.to_headers()
        assert headers["X-Machine-ID"] == "test-01"
        assert headers["X-API-Key"] == "secret-key"
        assert headers["Authorization"] == "Bearer secret-key"
        assert "X-Agent-Version" in headers

    def test_get_agent_coding_config_with_defaults(self):
        """Missing config fields get sensible defaults."""
        self.write_config({})
        import importlib
        import machine_identity_service as mis
        importlib.reload(mis)

        cfg = mis.get_agent_coding_config()
        assert cfg["enabled"] is False
        assert cfg["poll_commands_seconds"] == 60
        assert cfg["heartbeat_seconds"] == 60
        assert cfg["timeout_seconds"] == 15
        assert cfg["base_url"] == "http://localhost:4001"

    def test_get_agent_coding_config_user_overrides(self):
        """User config overrides default values."""
        self.write_config({
            "agent_coding": {
                "enabled": True,
                "base_url": "http://192.168.1.50:3456",
                "poll_commands_seconds": 30,
                "heartbeat_seconds": 120,
            }
        })
        import importlib
        import machine_identity_service as mis
        importlib.reload(mis)

        cfg = mis.get_agent_coding_config()
        assert cfg["enabled"] is True
        assert cfg["base_url"] == "http://192.168.1.50:3456"
        assert cfg["poll_commands_seconds"] == 30
        assert cfg["heartbeat_seconds"] == 120
        # defaults preserved
        assert cfg["timeout_seconds"] == 15

    def test_is_agent_coding_enabled_combined_check(self):
        """is_agent_coding_enabled checks both config and env var."""
        self.write_config({
            "machine": {"machine_id": "test-01"},
            "agent_coding": {"enabled": True},
        })
        os.environ.pop("MI_CORE_API_KEY", None)
        os.environ["AGENT_CODING_API_KEY"] = "key"
        import importlib
        import machine_identity_service as mis
        importlib.reload(mis)

        assert mis.is_agent_coding_enabled() is True

        os.environ.pop("AGENT_CODING_API_KEY", None)
        importlib.reload(mis)
        assert mis.is_agent_coding_enabled() is False

        os.environ["AGENT_CODING_API_KEY"] = "key"
        self.write_config({"agent_coding": {"enabled": False}})
        importlib.reload(mis)
        assert mis.is_agent_coding_enabled() is False
