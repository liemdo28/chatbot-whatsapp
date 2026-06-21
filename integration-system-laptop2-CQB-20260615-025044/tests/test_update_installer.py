"""
tests/test_update_installer.py
Tests for update_installer.py — safety checks, install flow, agent restart.
"""
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent / "desktop-app"))

from services.update_installer import (
    check_install_safety, run_install, _stop_background_agent, _start_background_agent
)
from services.update_backup_service import BackupResult


def _make_mock_subprocess(returncode=0):
    mock = MagicMock()
    mock.return_value.returncode = returncode
    mock.return_value.stderr = ""
    return mock


def test_safety_check_passes_no_locks():
    with patch("services.update_installer._is_qb_sync_running", return_value=False), \
         patch("services.update_installer._is_remote_command_running", return_value=False):
        safe, reason = check_install_safety()
    assert safe is True


def test_install_blocked_if_qb_sync_running():
    with tempfile.TemporaryDirectory() as tmp:
        installer = Path(tmp) / "setup.exe"
        installer.write_bytes(b"MZ")

        backup = BackupResult(success=True, backup_path=Path(tmp), version="1.3.0")
        mock_sub = _make_mock_subprocess(0)

        with patch("services.update_installer._is_qb_sync_running", return_value=True), \
             patch("services.update_installer._is_remote_command_running", return_value=False), \
             patch("services.update_installer._report_event"):
            result = run_install(installer, "1.3.0", backup_result=backup, _subprocess=mock_sub)

    assert result.success is False
    assert "QB sync" in (result.error or "")


def test_install_blocked_if_backup_failed():
    with tempfile.TemporaryDirectory() as tmp:
        installer = Path(tmp) / "setup.exe"
        installer.write_bytes(b"MZ")

        bad_backup = BackupResult(success=False, backup_path=None, version="1.3.0", error="Disk full")
        mock_sub = _make_mock_subprocess(0)

        with patch("services.update_installer._is_qb_sync_running", return_value=False), \
             patch("services.update_installer._is_remote_command_running", return_value=False), \
             patch("services.update_installer._report_event"):
            result = run_install(installer, "1.3.0", backup_result=bad_backup, _subprocess=mock_sub)

    assert result.success is False
    assert "Backup failed" in (result.error or "")


def test_successful_install_reports_completed():
    with tempfile.TemporaryDirectory() as tmp:
        installer = Path(tmp) / "setup.exe"
        installer.write_bytes(b"MZ")

        backup = BackupResult(success=True, backup_path=Path(tmp) / "backup", version="1.3.0")
        mock_sub = _make_mock_subprocess(0)

        reported_events = []

        def mock_report(client, event_type, version, error=""):
            reported_events.append(event_type)

        with patch("services.update_installer._is_qb_sync_running", return_value=False), \
             patch("services.update_installer._is_remote_command_running", return_value=False), \
             patch("services.update_installer._report_event", side_effect=mock_report), \
             patch("services.update_installer._write_result"):
            result = run_install(installer, "1.3.0", backup_result=backup, _subprocess=mock_sub)

    assert result.success is True
    assert "UPDATE_INSTALL_STARTED" in reported_events
    assert "UPDATE_COMPLETED" in reported_events


def test_failed_installer_reports_failed():
    with tempfile.TemporaryDirectory() as tmp:
        installer = Path(tmp) / "setup.exe"
        installer.write_bytes(b"MZ")

        backup = BackupResult(success=True, backup_path=Path(tmp) / "backup", version="1.3.0")
        mock_sub = _make_mock_subprocess(returncode=1)  # installer fails

        reported_events = []

        def mock_report(client, event_type, version, error=""):
            reported_events.append(event_type)

        with patch("services.update_installer._is_qb_sync_running", return_value=False), \
             patch("services.update_installer._is_remote_command_running", return_value=False), \
             patch("services.update_installer._report_event", side_effect=mock_report), \
             patch("services.update_installer._write_result"):
            result = run_install(installer, "1.3.0", backup_result=backup, _subprocess=mock_sub)

    assert result.success is False
    assert "UPDATE_FAILED" in reported_events
