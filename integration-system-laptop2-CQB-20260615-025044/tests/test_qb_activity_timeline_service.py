"""
Tests for services/qb_activity_timeline_service.py
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
    load_timeline_config,
    _sort_key,
    _dedupe_events,
    _extract_time_display,
    _build_timeline_markdown,
    timeline_already_generated,
    TL_STATUS_PASS,
    TL_STATUS_WARNING,
    TL_STATUS_ERROR,
    TL_STATUS_SKIPPED,
)


# ── Config ─────────────────────────────────────────────────────────────────────

def test_load_timeline_config_defaults():
    cfg = load_timeline_config({})
    assert cfg["enabled"] is True
    assert cfg["daily_time"] == "09:15"
    assert cfg["output_dir"] == "logs/qb-activity"
    assert "sales_receipt" in cfg["include_transaction_types"]


def test_load_timeline_config_custom():
    raw = {
        "qb_activity_log": {
            "enabled": False,
            "daily_time": "08:00",
            "output_dir": "custom/logs",
        }
    }
    cfg = load_timeline_config(raw)
    assert cfg["enabled"] is False
    assert cfg["daily_time"] == "08:00"
    assert cfg["output_dir"] == "custom/logs"


# ── Duplicate guard ─────────────────────────────────────────────────────────────

def test_timeline_already_generated_false(tmp_path):
    assert timeline_already_generated(tmp_path, "bandera", "2026-06-03") is False


def test_timeline_already_generated_true(tmp_path):
    store_dir = tmp_path / "bandera"
    store_dir.mkdir()
    (store_dir / "2026-06-03-timeline.json").write_text("{}", encoding="utf-8")
    assert timeline_already_generated(tmp_path, "bandera", "2026-06-03") is True


# ── Markdown builder ──────────────────────────────────────────────────────────

def test_build_timeline_markdown_contains_events():
    tl = {
        "store": "bandera", "store_name": "Bakudan Bandera",
        "date": "2026-06-03",
        "quickbooks_company_file": "Bandera.qbw",
        "generated_at": "2026-06-03T09:15:00",
        "status": "PASS",
        "event_count": 1,
        "events": [{
            "time": "09:15", "type": "sales_receipt",
            "ref_number": "REF-001", "txn_date": "2026-06-03",
            "amount": 120.50, "customer": "Toast Sales",
            "class": "Bandera", "account": "", "source": "QuickBooks",
        }],
        "warnings": [],
        "errors": [],
    }
    md = _build_timeline_markdown(tl)
    assert "# QB Activity Timeline" in md
    assert "Bakudan Bandera" in md
    assert "PASS" in md
    assert "REF-001" in md
    assert "$120.50" in md
    assert "sales_receipt" in md


def test_build_timeline_markdown_no_events():
    tl = {
        "store": "x", "store_name": "X", "date": "2026-06-03",
        "quickbooks_company_file": "x.qbw", "generated_at": "",
        "status": "WARNING", "event_count": 0, "events": [],
        "warnings": ["No transactions found."], "errors": [],
    }
    md = _build_timeline_markdown(tl)
    assert "No events found" in md
    assert "No transactions found" in md


def test_build_timeline_markdown_errors():
    tl = {
        "store": "x", "store_name": "X", "date": "2026-06-03",
        "quickbooks_company_file": "x.qbw", "generated_at": "",
        "status": "ERROR", "event_count": 0, "events": [],
        "warnings": [], "errors": ["QB connection failed"],
    }
    md = _build_timeline_markdown(tl)
    assert "Errors" in md
    assert "QB connection failed" in md


# ── Time display ───────────────────────────────────────────────────────────────

def test_extract_time_display_time_modified():
    ev = {"time_modified": "2026-06-03T10:30:00"}
    assert _extract_time_display(ev) == "10:30"


def test_extract_time_display_falls_back_to_time_created():
    ev = {"time_created": "2026-06-03T08:15:00"}
    assert _extract_time_display(ev) == "08:15"


def test_extract_time_display_returns_dash_when_no_time():
    ev = {"txn_date": "2026-06-03"}
    assert _extract_time_display(ev) == "—"


# ── generate_timeline ─────────────────────────────────────────────────────────

def _mock_qb_client():
    mock_cls = MagicMock()
    instance = MagicMock()
    mock_cls.return_value = instance
    return mock_cls, instance


def test_generate_timeline_creates_json_and_md(tmp_path):
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
        result = generate_timeline(
            {"code": "bandera", "name": "Bakudan Bandera", "bank_accounts": []},
            str(qbw), tmp_path, date_str="2026-06-03",
        )

    json_path = tmp_path / "bandera" / "2026-06-03-timeline.json"
    assert json_path.exists()
    data = json.loads(json_path.read_text())
    assert data["store"] == "bandera"
    assert data["event_count"] >= 0

    md_path = tmp_path / "bandera" / "2026-06-03-timeline.md"
    assert md_path.exists()


def test_generate_timeline_missing_data_is_warning_not_crash(tmp_path):
    qbw = tmp_path / "test.qbw"
    qbw.write_text("fake")
    mock_cls, _ = _mock_qb_client()

    def fake_empty(*args, **kwargs):
        return [], ["No transactions found on 2026-06-03."], []

    with (
        patch("services.qb_activity_timeline_service.QBClient", mock_cls),
        patch("services.qb_activity_timeline_queries.query_all_for_date", fake_empty),
    ):
        result = generate_timeline(
            {"code": "bandera", "name": "Bandera", "bank_accounts": []},
            str(qbw), tmp_path, date_str="2026-06-03",
        )

    assert result["status"] == TL_STATUS_WARNING
    assert len(result["warnings"]) > 0


def test_generate_timeline_qb_connection_failure_is_error(tmp_path):
    qbw = tmp_path / "test.qbw"
    qbw.write_text("fake")
    mock_cls = MagicMock()
    mock_cls.return_value.connect.side_effect = RuntimeError("QB not available")

    with patch("services.qb_activity_timeline_service.QBClient", mock_cls):
        result = generate_timeline(
            {"code": "bandera", "name": "Bandera", "bank_accounts": []},
            str(qbw), tmp_path, date_str="2026-06-03",
        )

    assert result["status"] == TL_STATUS_ERROR
    assert len(result["errors"]) > 0
    # File is still written even on error
    assert (tmp_path / "bandera" / "2026-06-03-timeline.json").exists()


def test_generate_timeline_duplicate_guard(tmp_path):
    store_dir = tmp_path / "bandera"
    store_dir.mkdir()
    existing = {"store": "bandera", "date": "2026-06-03", "status": "OLD"}
    (store_dir / "2026-06-03-timeline.json").write_text(json.dumps(existing), encoding="utf-8")
    mock_cls = MagicMock()

    with patch("services.qb_activity_timeline_service.QBClient", mock_cls):
        result = generate_timeline(
            {"code": "bandera", "name": "Bandera", "bank_accounts": []},
            str(tmp_path / "fake.qbw"), tmp_path, date_str="2026-06-03",
        )

    mock_cls.assert_not_called()
    assert result.get("status") in ("OLD", TL_STATUS_SKIPPED)


def test_generate_timeline_force_overwrites(tmp_path):
    store_dir = tmp_path / "bandera"
    store_dir.mkdir()
    old = {"store": "bandera", "date": "2026-06-03", "status": "OLD"}
    (store_dir / "2026-06-03-timeline.json").write_text(json.dumps(old), encoding="utf-8")
    qbw = tmp_path / "test.qbw"
    qbw.write_text("fake")
    mock_cls, _ = _mock_qb_client()

    def fake_events(*args, **kwargs):
        return [
            {"txn_id": "TXN-1", "txn_type": "sales_receipt",
             "txn_date": "2026-06-03", "time_created": None, "time_modified": None,
             "ref_number": "NEW-001", "amount": 99.0, "customer": "Toast",
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

    assert result.get("status") != "OLD"


def test_generate_timeline_read_only(tmp_path):
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

    assert not instance.delete_transaction.called
    assert not instance.delete_transactions.called


def test_generate_timeline_output_folder_created_automatically(tmp_path):
    output = tmp_path / "deep" / "nested"
    assert not output.exists()
    qbw = tmp_path / "test.qbw"
    qbw.write_text("fake")
    mock_cls, _ = _mock_qb_client()

    def fake_events(*args, **kwargs):
        return [], [], []

    with (
        patch("services.qb_activity_timeline_service.QBClient", mock_cls),
        patch("services.qb_activity_timeline_queries.query_all_for_date", fake_events),
    ):
        generate_timeline(
            {"code": "bandera", "name": "Bandera", "bank_accounts": []},
            str(qbw), output, date_str="2026-06-03",
        )

    assert (output / "bandera" / "2026-06-03-timeline.json").exists()


# ── generate_all_timelines ─────────────────────────────────────────────────────

def test_generate_all_timelines_multiple_stores(tmp_path):
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

    cfg = {
        "output_dir": str(tmp_path),
        "include_transaction_types": ["sales_receipt"],
        "stores": [
            {"code": "bandera",   "name": "Bandera",   "bank_accounts": []},
            {"code": "stone_oak", "name": "Stone Oak", "bank_accounts": []},
        ],
    }
    qbw_paths = {"bandera": str(qbw), "stone_oak": str(qbw)}

    with (
        patch("services.qb_activity_timeline_service.QBClient", mock_cls),
        patch("services.qb_activity_timeline_queries.query_all_for_date", fake_events),
    ):
        results = generate_all_timelines(cfg, qbw_paths=qbw_paths, date_str="2026-06-03")

    assert len(results) == 2
    codes = {r["store"] for r in results}
    assert codes == {"bandera", "stone_oak"}


def test_generate_all_timelines_missing_qbw_path(tmp_path):
    qbw = tmp_path / "test.qbw"
    qbw.write_text("fake")
    mock_cls, _ = _mock_qb_client()

    cfg = {
        "output_dir": str(tmp_path),
        "include_transaction_types": [],
        "stores": [
            {"code": "stone_oak", "name": "Stone Oak", "bank_accounts": []},
        ],
    }
    qbw_paths = {}  # intentionally missing

    with (
        patch("services.qb_activity_timeline_service.QBClient", mock_cls),
    ):
        results = generate_all_timelines(cfg, qbw_paths=qbw_paths, date_str="2026-06-03")

    assert results[0]["status"] == TL_STATUS_ERROR


# ── Dedup integration ──────────────────────────────────────────────────────────

def test_generate_timeline_dedupes_duplicate_txn_ids(tmp_path):
    qbw = tmp_path / "test.qbw"
    qbw.write_text("fake")
    mock_cls, _ = _mock_qb_client()

    def fake_events(*args, **kwargs):
        events = [
            {"txn_id": "TXN-1", "txn_type": "sales_receipt",
             "txn_date": "2026-06-03", "time_created": None, "time_modified": None,
             "ref_number": "REF-001", "amount": 100.0, "customer": "Toast",
             "class_name": "Bandera", "account": None, "memo": None,
             "cleared": None, "extra": {}},
            # Duplicate
            {"txn_id": "TXN-1", "txn_type": "sales_receipt",
             "txn_date": "2026-06-03", "time_created": None, "time_modified": None,
             "ref_number": "REF-001", "amount": 100.0, "customer": "Toast",
             "class_name": "Bandera", "account": None, "memo": None,
             "cleared": None, "extra": {}},
        ]
        return events, [], []

    with (
        patch("services.qb_activity_timeline_service.QBClient", mock_cls),
        patch("services.qb_activity_timeline_queries.query_all_for_date", fake_events),
    ):
        result = generate_timeline(
            {"code": "bandera", "name": "Bandera", "bank_accounts": []},
            str(qbw), tmp_path, date_str="2026-06-03",
        )

    # Should only have 1 event (deduped)
    assert result["event_count"] == 1
