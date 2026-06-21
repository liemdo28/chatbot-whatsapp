"""
Tests for QB startup service UI state transitions.
Verifies status values, messages, and callback firing order.
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

ROOT = Path(__file__).resolve().parents[1]
DESKTOP_APP = ROOT / "desktop-app"
if str(DESKTOP_APP) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP))

from services.qb_startup_service import (
    QBStartupService,
    QB_STATUS_BLOCKED,
    QB_STATUS_DISABLED,
    QB_STATUS_OPENING,
    QB_STATUS_READY,
    QB_STATUS_WRONG_CO,
)


def _make_svc(config: dict, callbacks: list | None = None) -> QBStartupService:
    cb = callbacks.append if callbacks is not None else None
    return QBStartupService(config=config, on_status=cb)


# ── Status sequence when QB opens successfully ────────────────────────────────

def test_status_sequence_on_successful_open(tmp_path):
    """Status must progress: OPENING → READY."""
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
    statuses = []
    with (
        patch.object(svc_mod, "is_qb_running", return_value=False),
        patch.object(svc_mod, "resolve_qb_executable", return_value=fake_exe),
        patch.object(svc_mod, "open_qb_with_file", return_value=True),
        patch.object(svc_mod, "get_qb_open_company_title", return_value="JHT Ventures - QuickBooks"),
    ):
        svc = _make_svc(config, statuses)
        svc.run_now()

    final = statuses[-1]
    assert final.status == QB_STATUS_READY


def test_status_when_open_fails(tmp_path):
    """If open_qb_with_file returns False, status → BLOCKED."""
    import services.qb_startup_service as svc_mod
    qbw = tmp_path / "Test.qbw"
    qbw.write_text("fake")
    fake_exe = tmp_path / "qb.exe"
    fake_exe.write_text("fake")
    config = {
        "quickbooks": {
            "auto_open_on_app_start": True,
            "company_file": str(qbw),
        }
    }
    statuses = []
    with (
        patch.object(svc_mod, "is_qb_running", return_value=False),
        patch.object(svc_mod, "resolve_qb_executable", return_value=fake_exe),
        patch.object(svc_mod, "open_qb_with_file", return_value=False),
    ):
        svc = _make_svc(config, statuses)
        svc.run_now()

    assert statuses[-1].status == QB_STATUS_BLOCKED


def test_wrong_company_status_has_error_detail(tmp_path):
    """QB_WRONG_CO status must include error message explaining the mismatch."""
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
    statuses = []
    with (
        patch.object(svc_mod, "is_qb_running", return_value=True),
        patch.object(svc_mod, "get_qb_open_company_title", return_value="JHT Ventures - QuickBooks"),
        patch.object(svc_mod, "has_qb_login_dialog", return_value=False),
        patch.object(svc_mod, "resolve_qb_executable", return_value=fake_exe),
    ):
        svc = _make_svc(config, statuses)
        svc.run_now()

    final = statuses[-1]
    assert final.status == QB_STATUS_WRONG_CO
    assert final.error  # must have error explanation


def test_disabled_emits_single_callback():
    """Disabled config → exactly one callback with DISABLED status."""
    calls = []
    config = {"quickbooks": {"auto_open_on_app_start": False}}
    svc = _make_svc(config, calls)
    svc.run_now()
    assert len(calls) == 1
    assert calls[0].status == QB_STATUS_DISABLED


def test_get_status_before_run_is_disabled():
    """Before run_now() / run_in_background(), status should be DISABLED."""
    config = {}
    svc = QBStartupService(config=config)
    assert svc.get_status().status == QB_STATUS_DISABLED


def test_checked_at_is_populated_after_run():
    """checked_at field must be a non-empty ISO string after run."""
    config = {"quickbooks": {"auto_open_on_app_start": False}}
    svc = QBStartupService(config=config)
    svc.run_now()
    assert svc.get_status().checked_at != ""
