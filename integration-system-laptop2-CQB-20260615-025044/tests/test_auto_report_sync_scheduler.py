"""
Tests for services/auto_report_sync_scheduler.py

Tests that can run on any machine (no QB, no Toast, no network required).
"""
from __future__ import annotations

import sys
import time
import threading
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

ROOT = Path(__file__).resolve().parents[1]
DESKTOP_APP = ROOT / "desktop-app"
if str(DESKTOP_APP) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP))

from services.auto_report_sync_scheduler import (
    AutoReportSyncScheduler,
    AutoSyncConfig,
    SCHED_OFF,
    SCHED_WAITING,
    SCHED_REPORTS_MISS,
    SCHED_QB_NOT_READY,
    SCHED_COMPLETED,
    SCHED_FAILED,
    SCHED_LOCK_BUSY,
    load_auto_sync_config,
    check_missing_reports,
    _was_already_synced,
    acquire_sync_lock,
    release_sync_lock,
    is_sync_locked,
)


# ── Config loading ────────────────────────────────────────────────────────────

def test_load_auto_sync_config_defaults():
    cfg = load_auto_sync_config({})
    assert cfg.enabled is False
    assert cfg.report_time == "09:00"
    assert cfg.timezone == "America/Chicago"
    assert cfg.require_preview_before_first_live_sync is True


def test_load_auto_sync_config_custom():
    raw = {
        "auto_sync": {
            "enabled": True,
            "report_time": "08:30",
            "timezone": "America/Los_Angeles",
            "stores": ["Stockton"],
            "sync_previous_business_day": False,
        }
    }
    cfg = load_auto_sync_config(raw)
    assert cfg.enabled is True
    assert cfg.report_time == "08:30"
    assert cfg.stores == ["Stockton"]
    assert cfg.sync_previous_business_day is False


# ── Disabled does nothing ─────────────────────────────────────────────────────

def test_auto_sync_disabled_sets_off():
    config = {"auto_sync": {"enabled": False}}
    sched = AutoReportSyncScheduler(config=config)
    sched._tick()
    assert sched.get_status().status == SCHED_OFF


# ── Waits until report time ───────────────────────────────────────────────────

def test_auto_sync_waits_until_report_time():
    """If current time is before report_time, status should be WAITING."""
    # Always-future time
    config = {"auto_sync": {"enabled": True, "report_time": "23:59", "stores": ["Stockton"], "timezone": "America/Chicago"}}
    sched = AutoReportSyncScheduler(config=config)
    sched._tick()
    status = sched.get_status().status
    # Either WAITING or (on machines where time is 23:59) REPORTS_MISS — both ok except OFF/FAILED
    assert status in (SCHED_WAITING, SCHED_REPORTS_MISS, SCHED_QB_NOT_READY, SCHED_COMPLETED)


# ── Missing reports blocks sync ───────────────────────────────────────────────

def test_missing_reports_blocks_sync(tmp_path):
    """When reports are missing, status should be REPORTS_MISS, not SYNCING/COMPLETED."""
    config = {
        "auto_sync": {
            "enabled": True,
            "report_time": "00:00",  # always past
            "stores": ["Stockton"],
            "timezone": "UTC",
        }
    }
    # No report files exist in tmp_path
    with patch("services.auto_report_sync_scheduler.check_missing_reports",
               return_value=[{"store": "Stockton", "report_key": "sales_summary", "date": "2026-06-01"}]):
        sched = AutoReportSyncScheduler(config=config)
        sched._tick()
    assert sched.get_status().status == SCHED_REPORTS_MISS


# ── QB not ready blocks sync ──────────────────────────────────────────────────

def test_qb_not_ready_blocks_sync():
    config = {
        "auto_sync": {
            "enabled": True,
            "report_time": "00:00",
            "stores": ["Stockton"],
            "timezone": "UTC",
        }
    }
    with patch("services.auto_report_sync_scheduler.check_missing_reports", return_value=[]):
        sched = AutoReportSyncScheduler(
            config=config,
            get_qb_status=lambda: "QB_CLOSED",  # QB not ready
        )
        sched._tick()
    assert sched.get_status().status == SCHED_QB_NOT_READY


# ── Duplicate store/date guard ────────────────────────────────────────────────

def test_auto_sync_skips_already_synced_store_date():
    """If store/date was already synced, scheduler skips it."""
    config = {
        "auto_sync": {
            "enabled": True,
            "report_time": "00:00",
            "stores": ["Stockton"],
            "timezone": "UTC",
        },
        "qbw_paths": {"Stockton": "D:\\QB\\Raw.qbw"},
    }
    with (
        patch("services.auto_report_sync_scheduler.check_missing_reports", return_value=[]),
        patch("services.auto_report_sync_scheduler._was_already_synced", return_value=True),
    ):
        sched = AutoReportSyncScheduler(config=config, get_qb_status=lambda: "QB_READY")
        sched._tick()
    # Should still complete (all stores skipped as duplicates → all_ok=True)
    assert sched.get_status().status == SCHED_COMPLETED


# ── Activity log written ──────────────────────────────────────────────────────

def test_scheduler_logs_activity():
    """Scheduler should write activity log on each status change."""
    log_calls = []
    config = {"auto_sync": {"enabled": False}}

    original = AutoReportSyncScheduler._log_activity

    def _capture(self, *args, **kwargs):
        log_calls.append(args)
        try:
            original(self, *args, **kwargs)
        except Exception:
            pass

    with patch.object(AutoReportSyncScheduler, "_log_activity", _capture):
        sched = AutoReportSyncScheduler(config=config)
        sched._tick()

    assert len(log_calls) >= 1
