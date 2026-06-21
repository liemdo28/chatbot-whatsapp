"""
Tests for sync lock primitives in auto_report_sync_scheduler.
Verifies that only one sync can run at a time.
"""
from __future__ import annotations

import sys
import threading
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
DESKTOP_APP = ROOT / "desktop-app"
if str(DESKTOP_APP) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP))

from services.auto_report_sync_scheduler import (
    acquire_sync_lock,
    release_sync_lock,
    is_sync_locked,
    _SYNC_LOCK,
)


def _reset_lock():
    """Ensure lock is free before each test."""
    _SYNC_LOCK.set()


@pytest.fixture(autouse=True)
def reset_lock_fixture():
    _reset_lock()
    yield
    _reset_lock()


def test_acquire_and_release():
    assert acquire_sync_lock() is True
    assert is_sync_locked() is True
    release_sync_lock()
    assert is_sync_locked() is False


def test_double_acquire_fails():
    assert acquire_sync_lock() is True
    # Second acquire with short timeout must fail
    assert acquire_sync_lock(timeout=0.1) is False
    release_sync_lock()


def test_release_makes_lock_available_again():
    acquire_sync_lock()
    release_sync_lock()
    acquired = acquire_sync_lock(timeout=0.5)
    assert acquired is True
    release_sync_lock()


def test_concurrent_workers_only_one_runs():
    """Simulate two threads trying to acquire the lock — only one succeeds."""
    results = []

    def _worker(name, wait_timeout):
        got = acquire_sync_lock(timeout=wait_timeout)
        results.append((name, got))
        if got:
            time.sleep(0.5)   # hold lock for 0.5s
            release_sync_lock()

    # t1 gets lock; t2 tries with a 0.1s timeout — not enough to wait for t1
    t1 = threading.Thread(target=_worker, args=("t1", 0.5))
    t2 = threading.Thread(target=_worker, args=("t2", 0.1))
    t1.start()
    time.sleep(0.05)  # ensure t1 acquires first
    t2.start()
    t1.join(timeout=3)
    t2.join(timeout=3)

    acquired = [r for r in results if r[1] is True]
    blocked = [r for r in results if r[1] is False]
    assert len(acquired) == 1, f"Expected exactly 1 acquirer, got {results}"
    assert len(blocked) == 1


def test_is_sync_locked_reflects_state():
    assert is_sync_locked() is False
    acquire_sync_lock()
    assert is_sync_locked() is True
    release_sync_lock()
    assert is_sync_locked() is False
