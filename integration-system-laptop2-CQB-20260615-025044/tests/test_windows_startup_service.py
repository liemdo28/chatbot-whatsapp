"""
Tests for services/windows_startup_service.py
"""

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Add desktop-app to Python path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "desktop-app"))

import services.windows_startup_service as mod


class TestWindowsStartupService:
    """Test Windows startup task registration."""

    def test_task_name_constant(self):
        """TASK_NAME is the expected scheduled task name."""
        assert mod.TASK_NAME == "ToastPOSManagerBackgroundAgent"

    def test_get_exe_path_returns_string(self):
        """_get_exe_path returns a non-empty string."""
        path = mod._get_exe_path()
        assert isinstance(path, str)
        assert len(path) > 0

    def test_get_task_xml_install_generates_valid_xml(self):
        """_get_task_xml_install generates well-formed XML."""
        xml = mod._get_task_xml_install(delay_seconds=30)

        # Basic XML structure checks
        assert '<?xml version="1.0"' in xml or '<?xml' in xml
        assert "<Task" in xml
        assert "</Task>" in xml
        assert "<LogonTrigger>" in xml
        assert "PT30S" in xml  # 30 seconds delay in ISO 8601 duration
        # Task name appears in Description, not directly in XML
        assert "Toast POS Manager - Background Agent" in xml

    def test_get_task_xml_install_custom_delay(self):
        """_get_task_xml_install respects custom delay."""
        xml = mod._get_task_xml_install(delay_seconds=60)
        assert "PT60S" in xml

    def test_get_startup_status_returns_dict(self):
        """get_startup_status returns expected dict shape."""
        with patch("services.windows_startup_service.is_startup_installed", return_value=False):
            status = mod.get_startup_status()

        assert isinstance(status, dict)
        assert "task_name" in status
        assert "installed" in status
        assert "exe_path" in status
        assert "trigger" in status
        assert "action" in status

    def test_get_startup_status_installed_true(self):
        """get_startup_status shows installed=True when task exists."""
        with patch("services.windows_startup_service.is_startup_installed", return_value=True):
            status = mod.get_startup_status()

        assert status["installed"] is True

    def test_get_startup_status_not_installed(self):
        """get_startup_status shows installed=False when task missing."""
        with patch("services.windows_startup_service.is_startup_installed", return_value=False):
            status = mod.get_startup_status()

        assert status["installed"] is False


class TestWindowsStartupInstall:
    """Test install_startup function."""

    def test_install_startup_calls_schtasks_on_success(self):
        """install_startup calls schtasks.exe and returns success."""
        with patch("services.windows_startup_service._run_schtasks") as mock_run:
            # First call: delete (succeeds)
            # Second call: create (succeeds)
            mock_run.side_effect = [
                (0, "OK", ""),  # delete
                (0, "Task created successfully", ""),  # create
            ]

            success, message = mod.install_startup(delay_seconds=30)

            assert success is True
            assert len(message) > 0
            # Should have called schtasks at least twice
            assert mock_run.call_count >= 2

    def test_install_startup_falls_back_on_xml_failure(self):
        """install_startup falls back to inline creation on XML failure."""
        with patch("services.windows_startup_service._run_schtasks") as mock_run:
            # delete succeeds
            # XML create fails
            # inline create succeeds
            mock_run.side_effect = [
                (0, "OK", ""),  # delete
                (1, "", "XML parse error"),  # XML create fails
                (0, "Task created successfully", ""),  # inline create
            ]

            success, message = mod.install_startup(delay_seconds=30)
            assert success is True

    def test_install_startup_returns_error_on_failure(self):
        """install_startup returns error when schtasks fails."""
        with patch("services.windows_startup_service._run_schtasks") as mock_run:
            mock_run.side_effect = [
                (0, "OK", ""),  # delete
                (1, "", "Access denied"),  # create fails
            ]

            success, message = mod.install_startup(delay_seconds=30)
            assert success is False


class TestWindowsStartupUninstall:
    """Test uninstall_startup function."""

    def test_uninstall_startup_calls_schtasks_delete(self):
        """uninstall_startup calls schtasks /Delete."""
        with patch("services.windows_startup_service._run_schtasks") as mock_run:
            mock_run.return_value = (0, "OK", "")

            success, message = mod.uninstall_startup()

            assert success is True
            # Should have called /Delete
            call_args = mock_run.call_args[0][0]
            assert "/Delete" in call_args
            assert "ToastPOSManagerBackgroundAgent" in call_args

    def test_uninstall_startup_succeeds_when_task_not_found(self):
        """uninstall_startup returns success if task already absent."""
        with patch("services.windows_startup_service._run_schtasks") as mock_run:
            # Error message contains "does not exist" → treated as already absent
            mock_run.return_value = (1, "", "ERROR: The task does not exist")

            success, message = mod.uninstall_startup()
            assert success is True


class TestIsStartupInstalled:
    """Test is_startup_installed function."""

    def test_returns_true_when_task_in_output(self):
        """is_startup_installed returns True when task name in output."""
        with patch("services.windows_startup_service._run_schtasks") as mock_run:
            mock_run.return_value = (0, "TaskName: ToastPOSManagerBackgroundAgent\nFolder:", "")

            result = mod.is_startup_installed()
            assert result is True

    def test_returns_false_when_task_not_found(self):
        """is_startup_installed returns False when task missing."""
        with patch("services.windows_startup_service._run_schtasks") as mock_run:
            mock_run.return_value = (1, "", "The system cannot find")

            result = mod.is_startup_installed()
            assert result is False