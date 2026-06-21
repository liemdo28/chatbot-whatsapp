"""
Tests for services/qb_activity_log_scheduler.py
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

from services.qb_activity_log_scheduler import (
    QBActivityLogScheduler,
    ALOG_OFF,
    ALOG_WAITING,
    ALOG_QB_NOT_READY,
    ALOG_RUNNING,
    ALOG_DONE,
    ALOG_FAILED,
)


def _make_sched(config=None, get_qb_status=None, callbacks=None):
    def _cb(status, msg):
        if callbacks is not None:
            callbacks.append((status, msg))
    return QBActivityLogScheduler(
        config=config or {},
        get_qb_status=get_qb_status,
        on_status=_cb if callbacks is not None else None,
        poll_interval_seconds=60,
    )


def test_disabled_sets_off():
    sched = _make_sched(config={"qb_activity_log": {"enabled": False}})
    sched._tick()
    status, _ = sched.get_status()
    assert status == ALOG_OFF


def test_no_stores_sets_off():
    sched = _make_sched(config={"qb_activity_log": {"enabled": True, "stores": []}})
    sched._tick()
    status, _ = sched.get_status()
    assert status == ALOG_OFF


def test_waiting_before_report_time():
    config = {
        "qb_activity_log": {
            "enabled": True,
            "daily_time": "23:59",
            "stores": [{"code": "bandera", "name": "Bandera"}],
        }
    }
    sched = _make_sched(config=config)
    sched._tick()
    status, msg = sched.get_status()
    # Should be WAITING or (if it's actually 23:59) DONE/RUNNING
    assert status in (ALOG_WAITING, ALOG_DONE, ALOG_RUNNING, ALOG_QB_NOT_READY)


def test_qb_not_ready_blocks():
    config = {
        "qb_activity_log": {
            "enabled": True,
            "daily_time": "00:00",
            "stores": [{"code": "bandera", "name": "Bandera"}],
        }
    }
    sched = _make_sched(config=config, get_qb_status=lambda: "QB_CLOSED")
    sched._tick()
    status, _ = sched.get_status()
    assert status == ALOG_QB_NOT_READY


def test_already_triggered_today_skips():
    """Once triggered today, next tick should skip and return ALOG_DONE."""
    config = {
        "qb_activity_log": {
            "enabled": True,
            "daily_time": "00:00",
            "stores": [{"code": "bandera", "name": "Bandera"}],
        }
    }
    from datetime import date
    # Patch generate_all_stores at the module where _run_logs imports it from
    with patch("services.qb_activity_log_service.generate_all_stores",
               return_value=[{"store": "bandera", "status": "PASS"}]):
        sched = _make_sched(config=config, get_qb_status=lambda: "QB_READY")
        sched._triggered_date = date.today().isoformat()  # pretend already ran today
        sched._tick()
        status, _ = sched.get_status()
        assert status == ALOG_DONE


def test_trigger_now_calls_run_logs():
    config = {
        "qb_activity_log": {
            "enabled": True,
            "daily_time": "00:00",
            "stores": [{"code": "bandera", "name": "Bandera"}],
        }
    }
    sched = _make_sched(config=config)
    with patch.object(sched, "_run_logs", return_value={"ok": True, "results": []}) as mock_run:
        result = sched.trigger_now(force=True)
    mock_run.assert_called_once_with(force=True)


def test_on_status_callback_fires():
    callbacks = []
    config = {"qb_activity_log": {"enabled": False}}
    sched = _make_sched(config=config, callbacks=callbacks)
    sched._tick()
    assert len(callbacks) >= 1
    assert callbacks[-1][0] == ALOG_OFF


def test_start_does_not_block():
    import time
    config = {"qb_activity_log": {"enabled": False}}
    sched = _make_sched(config=config)
    t0 = time.monotonic()
    sched.start()
    elapsed = time.monotonic() - t0
    sched.stop()
    assert elapsed < 1.0


def test_stop_sets_event():
    config = {"qb_activity_log": {"enabled": False}}
    sched = _make_sched(config=config)
    sched.start()
    sched.stop()
    assert sched._stop_event.is_set()
