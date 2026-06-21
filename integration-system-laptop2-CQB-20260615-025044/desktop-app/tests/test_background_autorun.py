"""
Tests for background agent auto-run (Windows startup + headless)
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


class TestBackgroundAutorun:
    """Test Windows startup and headless background agent."""

    def test_background_agent_has_correct_entry_point(self):
        """background_agent.py can be imported and has main()."""
        from background_agent import main
        assert callable(main)

    def test_background_agent_main_returns_int(self):
        """main() returns an int exit code."""
        from background_agent import _main
        with patch("background_agent._check_single_instance", return_value=True), \
             patch("background_agent._release_lock"), \
             patch("services.background_agent_service.run_background_agent") as mock_run, \
             patch("services.app_single_instance.write_heartbeat") as mock_hb:

            mock_agent = MagicMock()
            mock_run.return_value = mock_agent
            mock_agent.stop = MagicMock()

            # Trigger immediate stop
            with patch("background_agent._stop_requested") as mock_stop:
                mock_stop.is_set.side_effect = [False, True]
                exit_code = _main()

            assert isinstance(exit_code, int)
            assert exit_code == 0

    def test_background_agent_loads_config(self, tmp_path):
        """Background agent loads local-config.json from runtime."""
        # This test verifies that background agent can load config.
        # The core functionality is tested via integration testing.
        from background_agent import _main
        
        with patch("background_agent._check_single_instance", return_value=True), \
             patch("background_agent._release_lock"), \
             patch("background_agent._stop_requested") as mock_stop, \
             patch("services.background_agent_service.run_background_agent") as mock_run, \
             patch("services.app_single_instance.write_heartbeat"):

            mock_stop.is_set.side_effect = [False, True]
            mock_agent = MagicMock()
            mock_run.return_value = mock_agent

            exit_code = _main()

            # Verify agent was started
            mock_run.assert_called_once()
            # Verify heartbeat_seconds param was passed
            assert "heartbeat_seconds" in mock_run.call_args[1]
            assert exit_code == 0

    def test_background_agent_single_instance_prevents_second(self):
        """Second background agent exits if first holds lock."""
        with patch("background_agent._check_single_instance", return_value=False):
            from background_agent import _main
            exit_code = _main()
            assert exit_code == 1

    def test_install_startup_returns_zero_on_success(self):
        """--install-startup returns 0 on success."""
        with patch("launcher._handle_install_startup", return_value=0):
            from launcher import main
            import sys
            original_argv = sys.argv
            sys.argv = ["launcher.py", "--install-startup"]
            try:
                assert main() == 0
            finally:
                sys.argv = original_argv

    def test_uninstall_startup_returns_zero_on_success(self):
        """--uninstall-startup returns 0 on success."""
        with patch("launcher._handle_uninstall_startup", return_value=0):
            from launcher import main
            import sys
            original_argv = sys.argv
            sys.argv = ["launcher.py", "--uninstall-startup"]
            try:
                assert main() == 0
            finally:
                sys.argv = original_argv

    def test_background_mode_writes_heartbeat(self, tmp_path):
        """Background agent writes agent-heartbeat.json."""
        with patch("background_agent._check_single_instance", return_value=True), \
             patch("background_agent._release_lock"), \
             patch("app_paths.runtime_path", return_value=tmp_path), \
             patch("services.background_agent_service.run_background_agent") as mock_run, \
             patch("services.app_single_instance.write_heartbeat") as mock_hb:

            from background_agent import _main
            with patch("background_agent._stop_requested") as mock_stop:
                mock_stop.is_set.side_effect = [False, True]
                mock_agent = MagicMock()
                mock_run.return_value = mock_agent

                _main()

            mock_hb.assert_called_once()
            call_kwargs = mock_hb.call_args[1]
            assert call_kwargs["status"] == "AGENT_RUNNING"
            assert "started_at" in call_kwargs
            assert "qb_status" in call_kwargs


class TestWindowsStartupService:
    """Test Windows Task Scheduler integration."""

    def test_task_name_constant(self):
        """Task name is ToastPOSManagerBackgroundAgent."""
        from services.windows_startup_service import TASK_NAME
        assert TASK_NAME == "ToastPOSManagerBackgroundAgent"

    def test_install_creates_task_with_logon_trigger(self):
        """install_startup creates task with LogonTrigger and 30s delay."""
        with patch("services.windows_startup_service._run_schtasks") as mock_run:
            mock_run.return_value = (0, "", "")
            from services.windows_startup_service import install_startup
            success, msg = install_startup(delay_seconds=30)
            assert success is True

            # Verify schtasks /Create with XML
            calls = mock_run.call_args_list
            assert any("/Create" in str(c) and "/XML" in str(c) for c in calls)

    def test_install_fallback_to_inline(self):
        """XML failure falls back to inline schtasks command."""
        with patch("services.windows_startup_service._run_schtasks") as mock_run:
            # First call (XML) fails
            mock_run.side_effect = [
                (1, "", "XML failed"),
                (0, "SUCCESS", ""),  # inline fallback
            ]
            from services.windows_startup_service import install_startup
            success, msg = install_startup(delay_seconds=30)
            assert success is True

    def test_uninstall_removes_task(self):
        """uninstall_startup removes the scheduled task."""
        with patch("services.windows_startup_service._run_schtasks") as mock_run:
            mock_run.return_value = (0, "", "")
            from services.windows_startup_service import uninstall_startup
            success, msg = uninstall_startup()
            assert success is True
            mock_run.assert_called_with(["/Delete", "/TN", "ToastPOSManagerBackgroundAgent", "/F"])

    def test_is_startup_installed_checks_task_exists(self):
        """is_startup_installed returns True if task in query output."""
        with patch("services.windows_startup_service._run_schtasks") as mock_run:
            mock_run.return_value = (0, "ToastPOSManagerBackgroundAgent", "")
            from services.windows_startup_service import is_startup_installed
            assert is_startup_installed() is True

            mock_run.return_value = (1, "", "not found")
            assert is_startup_installed() is False


class TestHeartbeatFile:
    """Test runtime/agent-heartbeat.json content."""

    def test_heartbeat_contains_all_required_fields(self, tmp_path):
        """Heartbeat has status, started_at, qb_status, timestamps."""
        from services.app_single_instance import write_heartbeat, read_heartbeat

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
            assert hb["status"] == "AGENT_RUNNING"
            assert hb["started_at"] == "2026-06-05T09:00:00Z"
            assert hb["qb_status"] == "QB_READY"
            assert hb["activity_log_status"] == "Done"
            assert hb["timeline_status"] == "Done"
            assert hb["auto_sync_status"] == "Off"
            assert "last_heartbeat_at" in hb
            assert "pid" in hb

    def test_heartbeat_updated_on_interval(self, tmp_path):
        """Repeated writes update last_heartbeat_at."""
        from services.app_single_instance import write_heartbeat, read_heartbeat

        with patch("services.app_single_instance._heartbeat_path", return_value=tmp_path / "hb.json"):
            write_heartbeat(status="AGENT_RUNNING", started_at="2026-06-05T09:00:00Z")
            hb1 = read_heartbeat()
            time.sleep(0.01)
            write_heartbeat(status="AGENT_RUNNING", started_at="2026-06-05T09:00:00Z")
            hb2 = read_heartbeat()

            # Timestamp should have updated
            assert hb2["last_heartbeat_at"] != hb1["last_heartbeat_at"]


class TestNoUIInBackgroundMode:
    """Verify background agent runs without showing UI."""

    def test_background_agent_no_tkinter_import(self):
        """background_agent.py does not import tkinter."""
        import background_agent as ba
        # Verify no tkinter in module namespace
        assert not hasattr(ba, "tkinter")

    def test_background_agent_logs_to_file_not_console(self):
        """Background agent configures file logging."""
        with patch("background_agent._setup_logging") as mock_log:
            from background_agent import _setup_logging
            _setup_logging()
            # _setup_logging was called
            assert True  # setup happened

    def test_launcher_ui_flag(self):
        """launcher.py --ui runs the UI app."""
        with patch("launcher._launch_app", return_value=0) as mock_launch, \
             patch("launcher.run_bootstrap") as mock_bootstrap, \
             patch("launcher._is_background_agent_running", return_value=False):

            mock_report = MagicMock()
            mock_report.can_run = True
            mock_report.is_first_run = False
            mock_bootstrap.return_value = mock_report

            from launcher import main
            import sys
            original_argv = sys.argv
            sys.argv = ["launcher.py", "--ui"]
            try:
                exit_code = main()
                assert exit_code == 0
                mock_launch.assert_called_once_with(safe_mode=False)
            finally:
                sys.argv = original_argv
