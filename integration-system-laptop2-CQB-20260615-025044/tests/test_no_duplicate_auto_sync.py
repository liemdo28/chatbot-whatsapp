"""
Tests that the auto sync scheduler never syncs the same store/date twice.
Uses an in-memory SQLite ledger to verify duplicate blocking.
"""
from __future__ import annotations

import sys
import uuid
from pathlib import Path
from unittest.mock import patch

import pytest

ROOT = Path(__file__).resolve().parents[1]
DESKTOP_APP = ROOT / "desktop-app"
if str(DESKTOP_APP) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP))


def _make_ledger(tmp_path):
    from sync_ledger import SyncLedger
    return SyncLedger(db_path=tmp_path / "test.db", audit_dir=tmp_path / "audit")


def _write_success(ledger, store, date):
    """Insert a successful sync record into the ledger."""
    result = ledger.begin_run(
        store=store,
        date=date,
        source_name="Toasttab",
        report_path="/fake/report.xlsx",
        report_hash="abc123",
        report_size=1024,
        report_mtime="2026-06-01T09:00:00",
        ref_number="REF-001",
        preview=False,
        strict_mode=True,
        qb_company_file="D:\\QB\\Test.qbw",
    )
    if result.allowed:
        ledger.mark_success(result.sync_id)
    return result


def test_ledger_blocks_duplicate_same_hash(tmp_path):
    """SyncLedger blocks duplicate with same store/date/hash."""
    ledger = _make_ledger(tmp_path)
    r1 = _write_success(ledger, "Stockton", "2026-06-01")
    assert r1.allowed is True

    r2 = ledger.begin_run(
        store="Stockton",
        date="2026-06-01",
        source_name="Toasttab",
        report_path="/fake/report.xlsx",
        report_hash="abc123",  # same hash
        report_size=1024,
        report_mtime="2026-06-01T09:00:00",
        ref_number="REF-002",
        preview=False,
        strict_mode=True,
        qb_company_file="D:\\QB\\Test.qbw",
    )
    assert r2.allowed is False
    assert "already synced" in r2.message.lower()


def test_ledger_allows_different_date(tmp_path):
    """Same store but different date is allowed."""
    ledger = _make_ledger(tmp_path)
    _write_success(ledger, "Stockton", "2026-06-01")
    r2 = ledger.begin_run(
        store="Stockton",
        date="2026-06-02",   # different date
        source_name="Toasttab",
        report_path="/fake/report2.xlsx",
        report_hash="def456",
        report_size=1024,
        report_mtime="2026-06-02T09:00:00",
        ref_number="REF-003",
        preview=False,
        strict_mode=True,
        qb_company_file="D:\\QB\\Test.qbw",
    )
    assert r2.allowed is True


def test_ledger_allows_different_store(tmp_path):
    """Same date but different store is allowed."""
    ledger = _make_ledger(tmp_path)
    _write_success(ledger, "Stockton", "2026-06-01")
    r2 = ledger.begin_run(
        store="The Rim",  # different store
        date="2026-06-01",
        source_name="Toasttab",
        report_path="/fake/report3.xlsx",
        report_hash="abc123",
        report_size=1024,
        report_mtime="2026-06-01T09:00:00",
        ref_number="REF-004",
        preview=False,
        strict_mode=True,
        qb_company_file="D:\\QB\\JHT.qbw",
    )
    assert r2.allowed is True


def test_scheduler_was_already_synced_check(tmp_path):
    """_was_already_synced() returns True only after a success is recorded."""
    import services.auto_report_sync_scheduler as sched_mod
    from services.auto_report_sync_scheduler import _was_already_synced

    ledger = _make_ledger(tmp_path)

    with patch.object(sched_mod, "SyncLedger", return_value=ledger):
        before = _was_already_synced("Stockton", "2026-06-01")
        assert before is False

        _write_success(ledger, "Stockton", "2026-06-01")

        after = _was_already_synced("Stockton", "2026-06-01")
        assert after is True


def test_preview_does_not_block_live_sync(tmp_path):
    """A preview_success record should NOT block a subsequent live sync attempt."""
    ledger = _make_ledger(tmp_path)
    # preview run
    r1 = ledger.begin_run(
        store="Stockton",
        date="2026-06-01",
        source_name="Toasttab",
        report_path="/fake/report.xlsx",
        report_hash="abc123",
        report_size=1024,
        report_mtime="2026-06-01T09:00:00",
        ref_number="REF-P",
        preview=True,
        strict_mode=True,
        qb_company_file="D:\\QB\\Test.qbw",
    )
    assert r1.allowed is True
    ledger.mark_success(r1.sync_id, preview=True)

    # Live run — must be allowed (preview doesn't block live)
    r2 = ledger.begin_run(
        store="Stockton",
        date="2026-06-01",
        source_name="Toasttab",
        report_path="/fake/report.xlsx",
        report_hash="abc123",
        report_size=1024,
        report_mtime="2026-06-01T09:00:00",
        ref_number="REF-L",
        preview=False,
        strict_mode=True,
        qb_company_file="D:\\QB\\Test.qbw",
    )
    assert r2.allowed is True, f"Expected live sync allowed after preview; got: {r2.message}"
