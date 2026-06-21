"""
Tests for services/qb_startup_service.py

These tests run without QuickBooks Desktop installed.
QB-specific automation tests (open_qb_with_file) are skipped on non-QB machines.
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

ROOT = Path(__file__).resolve().parents[1]
DESKTOP_APP = ROOT / "desktop-app"
if str(DESKTOP_APP) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP))

from services.qb_startup_service import (
    QBStartupConfig,
    QBStartupService,
    QB_STATUS_BLOCKED,
    QB_STATUS_CLOSED,
    QB_STATUS_DISABLED,
    QB_STATUS_READY,
    QB_STATUS_WRONG_CO,
    _company_name_in_title,
    load_qb_startup_config,
)


# ── Config loading ────────────────────────────────────────────────────────────

def test_load_qb_startup_config_defaults():
    cfg = load_qb_startup_config({})
    assert cfg.auto_open_on_app_start is True
    assert cfg.startup_timeout_seconds == 90
    assert cfg.password_key == "pass1"


def test_load_qb_startup_config_custom():
    raw = {
        "quickbooks": {
            "auto_open_on_app_start": False,
            "allow_company_switch": True,
            "startup_timeout_seconds": 60,
            "company_file": "D:\\QB\\Test.qbw",
            "password_key": "pass2",
        }
    }
    cfg = load_qb_startup_config(raw)
    assert cfg.auto_open_on_app_start is False
    assert cfg.allow_company_switch is True
    assert cfg.startup_timeout_seconds == 60
    assert cfg.company_file == "D:\\QB\\Test.qbw"
    assert cfg.password_key == "pass2"


# ── Disabled guard ────────────────────────────────────────────────────────────

def test_auto_open_disabled_does_nothing():
    """When auto_open_on_app_start=false, status must be QB_DISABLED."""
    config = {"quickbooks": {"auto_open_on_app_start": False}}
    svc = QBStartupService(config=config)
    result = svc.run_now()
    assert result.status == QB_STATUS_DISABLED


# ── Missing company file ──────────────────────────────────────────────────────

def test_missing_company_file_blocks_safely():
    """No company file configured → QB_BLOCKED, no crash."""
    config = {
        "quickbooks": {"auto_open_on_app_start": True},
        "qbw_paths": {},
    }
    svc = QBStartupService(config=config)
    result = svc.run_now()
    assert result.status == QB_STATUS_BLOCKED
    assert "company file" in result.error.lower() or "company file" in result.message.lower()


# ── Invalid file path ─────────────────────────────────────────────────────────

def test_nonexistent_company_file_blocks_safely(tmp_path):
    """Company file path does not exist → QB_BLOCKED."""
    fake_path = str(tmp_path / "nonexistent.qbw")
    config = {
        "quickbooks": {
            "auto_open_on_app_start": True,
            "company_file": fake_path,
        }
    }
    svc = QBStartupService(config=config)
    result = svc.run_now()
    assert result.status == QB_STATUS_BLOCKED
    assert result.company_file == fake_path


# ── Missing QB executable ─────────────────────────────────────────────────────

def test_missing_qb_exe_blocks_safely(tmp_path):
    """QB exe not found → QB_BLOCKED with helpful error."""
    import services.qb_startup_service as svc_mod
    qbw = tmp_path / "Test.qbw"
    qbw.write_text("fake")
    config = {
        "quickbooks": {
            "auto_open_on_app_start": True,
            "company_file": str(qbw),
            "exe_path": str(tmp_path / "nonexistent_qb.exe"),
        }
    }
    with patch.object(svc_mod, "resolve_qb_executable", return_value=None):
        svc = QBStartupService(config=config)
        result = svc.run_now()
    assert result.status == QB_STATUS_BLOCKED
    assert "executable" in result.message.lower() or "executable" in result.error.lower()


# ── QB already running — correct company ─────────────────────────────────────

def test_qb_already_running_correct_company(tmp_path):
    """QB is running and window title matches → QB_READY."""
    import services.qb_startup_service as svc_mod
    qbw = tmp_path / "JHT Ventures.qbw"
    qbw.write_text("fake")
    fake_exe = tmp_path / "qb.exe"
    fake_exe.write_text("fake")
    config = {
        "quickbooks": {
            "auto_open_on_app_start": True,
            "company_file": str(qbw),
        }
    }
    with (
        patch.object(svc_mod, "is_qb_running", return_value=True),
        patch.object(svc_mod, "get_qb_open_company_title", return_value="JHT Ventures - QuickBooks"),
        patch.object(svc_mod, "has_qb_login_dialog", return_value=False),
        patch.object(svc_mod, "resolve_qb_executable", return_value=fake_exe),
    ):
        svc = QBStartupService(config=config)
        result = svc.run_now()
    assert result.status == QB_STATUS_READY


def test_company_title_matches_expected_company_name():
    assert _company_name_in_title(
        "Raw Japanese Bistro and Sushi Bar - Intuit QuickBooks Enterprise Solutions 24.0",
        r"C:\QB Data\Raw Stockton\rawstockton.qbw",
        "Raw Japanese Bistro and Sushi Bar",
    ) is True


def test_generic_quickbooks_title_is_not_treated_as_wrong_company():
    assert _company_name_in_title(
        " Intuit QuickBooks Enterprise Solutions 24.0",
        r"C:\QB Data\Raw Stockton\rawstockton.qbw",
        "Raw Japanese Bistro and Sushi Bar",
    ) is True


# ── QB running wrong company, switch not allowed ─────────────────────────────

def test_login_dialog_blocks_when_password_missing(tmp_path):
    """QB running with login dialog should not be reported as ready."""
    import services.qb_startup_service as svc_mod
    qbw = tmp_path / "RawStockton.qbw"
    qbw.write_text("fake")
    fake_exe = tmp_path / "qb.exe"
    fake_exe.write_text("fake")
    config = {
        "quickbooks": {
            "auto_open_on_app_start": True,
            "company_file": str(qbw),
            "password_key": "pass2",
        }
    }
    with (
        patch.object(svc_mod, "is_qb_running", return_value=True),
        patch.object(svc_mod, "get_qb_open_company_title", return_value=" Intuit QuickBooks Enterprise Solutions 24.0"),
        patch.object(svc_mod, "has_qb_login_dialog", return_value=True),
        patch.object(svc_mod, "_password_configured", return_value=False),
        patch.object(svc_mod, "resolve_qb_executable", return_value=fake_exe),
        patch.object(svc_mod, "open_qb_with_file") as open_qb,
    ):
        svc = QBStartupService(config=config)
        result = svc.run_now()
    assert result.status == QB_STATUS_BLOCKED
    assert "login" in result.message.lower()
    open_qb.assert_not_called()


def test_login_dialog_uses_configured_auto_login(tmp_path):
    import services.qb_startup_service as svc_mod
    qbw = tmp_path / "RawStockton.qbw"
    qbw.write_text("fake")
    fake_exe = tmp_path / "qb.exe"
    fake_exe.write_text("fake")
    config = {
        "quickbooks": {
            "auto_open_on_app_start": True,
            "company_file": str(qbw),
            "password_key": "pass2",
        }
    }
    with (
        patch.object(svc_mod, "is_qb_running", return_value=True),
        patch.object(svc_mod, "get_qb_open_company_title", return_value=" Intuit QuickBooks Enterprise Solutions 24.0"),
        patch.object(svc_mod, "has_qb_login_dialog", return_value=True),
        patch.object(svc_mod, "_password_configured", return_value=True),
        patch.object(svc_mod, "resolve_qb_executable", return_value=fake_exe),
        patch.object(svc_mod, "open_qb_with_file", return_value=True) as open_qb,
    ):
        svc = QBStartupService(config=config)
        result = svc.run_now()
    assert result.status == QB_STATUS_READY
    open_qb.assert_called_once()


def test_wrong_company_no_auto_switch(tmp_path):
    """QB running with different company and allow_company_switch=False → QB_WRONG_CO."""
    import services.qb_startup_service as svc_mod
    qbw = tmp_path / "RawStockton.qbw"
    qbw.write_text("fake")
    fake_exe = tmp_path / "qb.exe"
    fake_exe.write_text("fake")
    config = {
        "quickbooks": {
            "auto_open_on_app_start": True,
            "allow_company_switch": False,
            "company_file": str(qbw),
        }
    }
    with (
        patch.object(svc_mod, "is_qb_running", return_value=True),
        patch.object(svc_mod, "get_qb_open_company_title", return_value="JHT Ventures - QuickBooks"),
        patch.object(svc_mod, "has_qb_login_dialog", return_value=False),
        patch.object(svc_mod, "resolve_qb_executable", return_value=fake_exe),
    ):
        svc = QBStartupService(config=config)
        result = svc.run_now()
    assert result.status == QB_STATUS_WRONG_CO
    assert "allow_company_switch" in result.error or "wrong" in result.message.lower()


# ── on_status callback ────────────────────────────────────────────────────────

def test_on_status_callback_fires():
    """Verify on_status callback receives status updates."""
    received = []
    config = {"quickbooks": {"auto_open_on_app_start": False}}
    svc = QBStartupService(config=config, on_status=received.append)
    svc.run_now()
    assert len(received) >= 1
    assert received[-1].status == QB_STATUS_DISABLED


# ── Background thread does not block ─────────────────────────────────────────

def test_run_in_background_returns_immediately():
    """run_in_background() must return before the service finishes."""
    import time
    config = {"quickbooks": {"auto_open_on_app_start": False}}
    svc = QBStartupService(config=config)
    t_start = time.monotonic()
    svc.run_in_background()
    elapsed = time.monotonic() - t_start
    assert elapsed < 1.0, f"run_in_background blocked for {elapsed:.2f}s"
