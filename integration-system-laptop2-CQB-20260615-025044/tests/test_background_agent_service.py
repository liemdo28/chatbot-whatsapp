"""
Tests for services/background_agent_service.py
"""

import json
from unittest.mock import MagicMock, patch

import pytest


class TestBackgroundAgentService:
    """Test the background agent service."""

    def test_service_starts_and_stops(self):
        """Service can start and stop cleanly."""
        from services.background_agent_service import (
            BackgroundAgentService,
            AGENT_OFF,
            AGENT_RUNNING,
        )

        svc = BackgroundAgentService(heartbeat_seconds=5, command_poll_seconds=2)
        assert svc.get_status()["state"] == AGENT_OFF

        svc.start()
        # Give it a moment to initialize
        import time
        time.sleep(0.5)
        status = svc.get_status()
        assert status["state"] in (AGENT_RUNNING, "AGENT_STARTING")

        svc.stop()
        status2 = svc.get_status()
        assert status2["state"] == "AGENT_STOPPED"

    def test_service_get_status_returns_dict(self):
        """get_status returns a properly structured dict."""
        from services.background_agent_service import BackgroundAgentService

        svc = BackgroundAgentService(heartbeat_seconds=60, command_poll_seconds=10)
        status = svc.get_status()

        assert isinstance(status, dict)
        assert "state" in status
        assert "started_at" in status
        assert "qb_status" in status
        assert "activity_log_status" in status
        assert "timeline_status" in status
        assert "auto_sync_status" in status
        assert "last_error" in status

    def test_service_state_constants(self):
        """All required state constants are defined."""
        from services.background_agent_service import (
            AGENT_OFF,
            AGENT_STARTING,
            AGENT_RUNNING,
            AGENT_STOPPING,
            AGENT_STOPPED,
            LOG_WAITING,
            LOG_RUNNING,
            LOG_DONE,
            LOG_FAILED,
            TIMELINE_WAITING,
            TIMELINE_RUNNING,
            TIMELINE_DONE,
            TIMELINE_FAILED,
        )

        # All constants should be non-empty strings
        for const in [AGENT_OFF, AGENT_STARTING, AGENT_RUNNING, AGENT_STOPPING, AGENT_STOPPED]:
            assert isinstance(const, str)
            assert len(const) > 0

        for const in [LOG_WAITING, LOG_RUNNING, LOG_DONE, LOG_FAILED]:
            assert isinstance(const, str)
            assert len(const) > 0

        for const in [TIMELINE_WAITING, TIMELINE_RUNNING, TIMELINE_DONE, TIMELINE_FAILED]:
            assert isinstance(const, str)
            assert len(const) > 0


class TestBackgroundAgentServiceCommandProcessing:
    """Test command processing in background agent."""

    def test_service_with_mock_qb_startup(self):
        """Service starts with mock QB startup service."""
        from services.background_agent_service import BackgroundAgentService

        # Mock the QB startup service
        mock_qb = MagicMock()
        mock_status = MagicMock()
        mock_status.status = "QB_READY"
        mock_qb.get_status.return_value = mock_status

        svc = BackgroundAgentService(heartbeat_seconds=60, command_poll_seconds=5)
        svc._qb_startup_svc = mock_qb

        svc.start()
        import time
        time.sleep(0.3)

        status = svc.get_status()
        assert "state" in status

        svc.stop()

    def test_service_does_not_crash_on_config_load_failure(self):
        """Service gracefully handles config load failures."""
        from services.background_agent_service import BackgroundAgentService

        with patch("services.background_agent_service._load_local_config", side_effect=Exception("Config error")):
            svc = BackgroundAgentService(heartbeat_seconds=60, command_poll_seconds=5)
            # Should not raise
            svc.start()
            import time
            time.sleep(0.2)
            status = svc.get_status()
            assert "state" in status
            svc.stop()


class TestRunBackgroundAgent:
    """Test the run_background_agent helper function."""

    def test_run_background_agent_returns_service(self):
        """run_background_agent returns a BackgroundAgentService instance."""
        from services.background_agent_service import run_background_agent

        agent = run_background_agent(heartbeat_seconds=60, command_poll_seconds=10)
        try:
            assert agent is not None
            import time
            time.sleep(0.2)
            status = agent.get_status()
            assert "state" in status
        finally:
            agent.stop()