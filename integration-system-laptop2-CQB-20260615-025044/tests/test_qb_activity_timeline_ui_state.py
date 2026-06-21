"""
Tests for QB Activity Timeline UI state and edge cases.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

ROOT = Path(__file__).resolve().parents[1]
DESKTOP_APP = ROOT / "desktop-app"
if str(DESKTOP_APP) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP))

from services.qb_activity_timeline_service import (
    generate_timeline,
    generate_all_timelines,
    _build_timeline_markdown,
    TL_STATUS_PASS,
    TL_STATUS_WARNING,
    TL_STATUS_ERROR,
)


def _mock_qb_client():
    mock_cls = MagicMock()
    instance = MagicMock()
    mock_cls.return_value = instance
    return mock_cls, instance


# ── Wrong company file ─────────────────────────────────────────────────────────

def test_wrong_company_file_returns_error(tmp_path):
    mock_cls = MagicMock()
    mock_cls.return_value.connect.side_effect = FileNotFoundError("No such file")
    with patch("services.qb_activity_timeline_service.QBClient", mock_cls):
        result = generate_timeline(
            {"code": "bandera", "name": "Bandera", "bank_accounts": []},
            str(tmp_path / "nonexistent.qbw"), tmp_path,
            date_str="2026-06-03",
        )
    assert result["status"] == TL_STATUS_ERROR
    assert len(result["errors"]) > 0


def test_qb_closed_returns_error(tmp_path):
    mock_cls = MagicMock()
    mock_cls.return_value.connect.side_effect = RuntimeError("QB is not running")
    with patch("services.qb_activity_timeline_service.QBClient", mock_cls):
        result = generate_timeline(
            {"code": "bandera", "name": "Bandera", "bank_accounts": []},
            str(tmp_path / "fake.qbw"), tmp_path,
            date_str="2026-06-03",
        )
    assert result["status"] == TL_STATUS_ERROR


# ── No data → WARNING not crash ───────────────────────────────────────────────

def test_no_data_returns_warning_not_crash(tmp_path):
    qbw = tmp_path / "test.qbw"
    qbw.write_text("fake")
    mock_cls, _ = _mock_qb_client()

    def fake_empty(*args, **kwargs):
        return [], ["No sales_receipt transactions found on 2026-06-03.",
                    "No invoice transactions found on 2026-06-03."], []

    with (
        patch("services.qb_activity_timeline_service.QBClient", mock_cls),
        patch("services.qb_activity_timeline_queries.query_all_for_date", fake_empty),
    ):
        result = generate_timeline(
            {"code": "bandera", "name": "Bandera", "bank_accounts": []},
            str(qbw), tmp_path, date_str="2026-06-03",
        )

    assert result["status"] == TL_STATUS_WARNING
    assert result["event_count"] == 0
    assert len(result["warnings"]) > 0


# ── Markdown is human-readable ────────────────────────────────────────────────

def test_timeline_markdown_is_human_readable(tmp_path):
    qbw = tmp_path / "test.qbw"
    qbw.write_text("fake")
    mock_cls, _ = _mock_qb_client()

    def fake_events(*args, **kwargs):
        return [
            {"txn_id": "TXN-1", "txn_type": "sales_receipt",
             "txn_date": "2026-06-03", "time_created": "2026-06-03T09:15:00",
             "time_modified": None, "ref_number": "REF-001", "amount": 120.50,
             "customer": "Toast Sales", "class_name": "Bandera",
             "account": None, "memo": None, "cleared": None, "extra": {}},
        ], [], []

    with (
        patch("services.qb_activity_timeline_service.QBClient", mock_cls),
        patch("services.qb_activity_timeline_queries.query_all_for_date", fake_events),
    ):
        generate_timeline(
            {"code": "bandera", "name": "Bakudan Bandera", "bank_accounts": ["Chase"]},
            str(qbw), tmp_path, date_str="2026-06-03",
        )

    md_path = tmp_path / "bandera" / "2026-06-03-timeline.md"
    assert md_path.exists()
    md = md_path.read_text()
    assert "# QB Activity Timeline" in md
    assert "Status:" in md
    assert "Bakudan Bandera" in md
    assert "REF-001" in md


def test_timeline_json_is_machine_readable(tmp_path):
    qbw = tmp_path / "test.qbw"
    qbw.write_text("fake")
    mock_cls, _ = _mock_qb_client()

    def fake_events(*args, **kwargs):
        return [
            {"txn_id": "TXN-1", "txn_type": "sales_receipt",
             "txn_date": "2026-06-03", "time_created": None, "time_modified": None,
             "ref_number": "REF-001", "amount": 100.0, "customer": "Toast",
             "class_name": "Bandera", "account": None, "memo": None,
             "cleared": None, "extra": {}},
        ], [], []

    with (
        patch("services.qb_activity_timeline_service.QBClient", mock_cls),
        patch("services.qb_activity_timeline_queries.query_all_for_date", fake_events),
    ):
        generate_timeline(
            {"code": "bandera", "name": "Bandera", "bank_accounts": []},
            str(qbw), tmp_path, date_str="2026-06-03",
        )

    json_path = tmp_path / "bandera" / "2026-06-03-timeline.json"
    data = json.loads(json_path.read_text())
    assert "store" in data
    assert "date" in data
    assert "status" in data
    assert "event_count" in data
    assert "events" in data
    assert "warnings" in data
    assert "errors" in data
    assert "generated_at" in data


# ── No QB write operations ────────────────────────────────────────────────────

def test_no_qb_write_operations(tmp_path):
    qbw = tmp_path / "test.qbw"
    qbw.write_text("fake")
    mock_cls, instance = _mock_qb_client()

    def fake_events(*args, **kwargs):
        return [], [], []

    with (
        patch("services.qb_activity_timeline_service.QBClient", mock_cls),
        patch("services.qb_activity_timeline_queries.query_all_for_date", fake_events),
    ):
        generate_timeline(
            {"code": "bandera", "name": "Bandera", "bank_accounts": []},
            str(qbw), tmp_path, date_str="2026-06-03",
        )

    write_methods = ["delete_transaction", "delete_transactions"]
    for method in write_methods:
        assert not getattr(instance, method).called, f"{method} should never be called"


# ── Force regenerate ──────────────────────────────────────────────────────────

def test_force_regenerate_overwrites_safely(tmp_path):
    store_dir = tmp_path / "bandera"
    store_dir.mkdir()
    original = {"store": "bandera", "date": "2026-06-03", "status": "OLD_DATA", "events": []}
    (store_dir / "2026-06-03-timeline.json").write_text(json.dumps(original), encoding="utf-8")

    qbw = tmp_path / "test.qbw"
    qbw.write_text("fake")
    mock_cls, _ = _mock_qb_client()

    def fake_events(*args, **kwargs):
        return [
            {"txn_id": "TXN-NEW", "txn_type": "invoice",
             "txn_date": "2026-06-03", "time_created": None, "time_modified": None,
             "ref_number": "NEW-001", "amount": 250.0, "customer": "New Customer",
             "class_name": "Bandera", "account": None, "memo": None,
             "cleared": None, "extra": {}},
        ], [], []

    with (
        patch("services.qb_activity_timeline_service.QBClient", mock_cls),
        patch("services.qb_activity_timeline_queries.query_all_for_date", fake_events),
    ):
        result = generate_timeline(
            {"code": "bandera", "name": "Bandera", "bank_accounts": []},
            str(qbw), tmp_path, date_str="2026-06-03", force=True,
        )

    new_data = json.loads((store_dir / "2026-06-03-timeline.json").read_text())
    assert new_data.get("status") != "OLD_DATA"
    assert result["event_count"] == 1


# ── UI summary display ────────────────────────────────────────────────────────

def test_summary_includes_event_count_and_latest_event(tmp_path):
    """Verify timeline dict has fields needed for UI summary."""
    qbw = tmp_path / "test.qbw"
    qbw.write_text("fake")
    mock_cls, _ = _mock_qb_client()

    def fake_events(*args, **kwargs):
        return [
            {"txn_id": "TXN-1", "txn_type": "sales_receipt",
             "txn_date": "2026-06-03", "time_created": "2026-06-03T09:00:00",
             "time_modified": None, "ref_number": "REF-001", "amount": 100.0,
             "customer": "Toast", "class_name": "Bandera",
             "account": None, "memo": None, "cleared": None, "extra": {}},
            {"txn_id": "TXN-2", "txn_type": "payment",
             "txn_date": "2026-06-03", "time_created": "2026-06-03T10:00:00",
             "time_modified": None, "ref_number": "PMT-001", "amount": 50.0,
             "customer": "Toast", "class_name": "Bandera",
             "account": None, "memo": None, "cleared": None, "extra": {}},
        ], [], []

    with (
        patch("services.qb_activity_timeline_service.QBClient", mock_cls),
        patch("services.qb_activity_timeline_queries.query_all_for_date", fake_events),
    ):
        result = generate_timeline(
            {"code": "bandera", "name": "Bandera", "bank_accounts": []},
            str(qbw), tmp_path, date_str="2026-06-03",
        )

    assert result["event_count"] == 2
    # Events are sorted by time_created
    assert result["events"][0]["type"] == "sales_receipt"
    assert result["events"][0]["time"] == "09:00"
    assert result["events"][1]["type"] == "payment"
    assert result["events"][1]["time"] == "10:00"
    # Latest event is last in the sorted list
    assert result["events"][-1]["type"] == "payment"
