"""
Tests for QB activity log service UI state and edge cases.
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

from services.qb_activity_log_service import (
    generate_activity_log,
    generate_all_stores,
    load_qb_activity_config,
    _build_markdown,
    LOG_STATUS_PASS,
    LOG_STATUS_WARNING,
    LOG_STATUS_ERROR,
)


def _fake_q(found=True, warning=None, error=None):
    return {
        "found": found,
        "last_txn_date": "2026-06-02" if found else None,
        "ref_number": "REF-001" if found else None,
        "amount": 100.0 if found else None,
        "customer": "Toast Sales" if found else None,
        "class_name": "Bandera" if found else None,
        "account": None, "memo": None, "cleared": None,
        "txn_id": None, "extra": {},
        "warning": warning,
        "error": error,
    }


def _patch_all_queries(**overrides):
    good = _fake_q(found=True)
    defaults = {
        "get_latest_sales_receipt": MagicMock(return_value=good),
        "get_latest_invoice": MagicMock(return_value=good),
        "get_latest_payment": MagicMock(return_value=good),
        "get_latest_deposit": MagicMock(return_value=good),
        "get_latest_journal_entry": MagicMock(return_value=good),
        "get_latest_bill": MagicMock(return_value=good),
        "get_latest_bank_transaction": MagicMock(return_value=good),
        "get_latest_reconcile_status": MagicMock(return_value=good),
    }
    defaults.update(overrides)
    return patch.multiple("services.qb_activity_queries", **defaults)


# ── Wrong company file ────────────────────────────────────────────────────────

def test_wrong_company_file_results_in_error(tmp_path):
    """If qbw_path doesn't exist, QB connect fails → ERROR log."""
    mock_cls = MagicMock()
    mock_cls.return_value.connect.side_effect = FileNotFoundError("No such file")
    with patch("services.qb_activity_log_service.QBClient", mock_cls):
        result = generate_activity_log(
            {"code": "bandera", "name": "Bandera", "bank_accounts": []},
            str(tmp_path / "nonexistent.qbw"), tmp_path,
            date_str="2026-06-03",
        )
    assert result["status"] == LOG_STATUS_ERROR
    assert any("No such file" in e or "nonexistent" in e or "error" in e.lower() for e in result["errors"])


# ── QB closed/not ready ───────────────────────────────────────────────────────

def test_qb_closed_before_query_results_in_error(tmp_path):
    mock_cls = MagicMock()
    mock_cls.return_value.connect.side_effect = RuntimeError("QB is not running")
    with patch("services.qb_activity_log_service.QBClient", mock_cls):
        result = generate_activity_log(
            {"code": "bandera", "name": "Bandera", "bank_accounts": []},
            str(tmp_path / "fake.qbw"), tmp_path,
            date_str="2026-06-03",
        )
    assert result["status"] == LOG_STATUS_ERROR


# ── Multiple stores ───────────────────────────────────────────────────────────

def test_generate_all_stores_handles_multiple(tmp_path):
    qbw = tmp_path / "test.qbw"
    qbw.write_text("fake")
    mock_cls = MagicMock()

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
        patch("services.qb_activity_log_service.QBClient", mock_cls),
        _patch_all_queries(),
    ):
        results = generate_all_stores(cfg, qbw_paths=qbw_paths, date_str="2026-06-03")

    assert len(results) == 2
    codes = {r["store"] for r in results}
    assert codes == {"bandera", "stone_oak"}


def test_generate_all_stores_missing_qbw_path(tmp_path):
    """Store with no qbw_path gets ERROR status, others continue."""
    qbw = tmp_path / "test.qbw"
    qbw.write_text("fake")
    mock_cls = MagicMock()

    cfg = {
        "output_dir": str(tmp_path),
        "include_transaction_types": [],
        "stores": [
            {"code": "bandera",   "name": "Bandera",   "bank_accounts": []},
            {"code": "stone_oak", "name": "Stone Oak", "bank_accounts": []},  # no path
        ],
    }
    qbw_paths = {"bandera": str(qbw)}  # stone_oak intentionally missing

    with (
        patch("services.qb_activity_log_service.QBClient", mock_cls),
        _patch_all_queries(),
    ):
        results = generate_all_stores(cfg, qbw_paths=qbw_paths, date_str="2026-06-03")

    statuses = {r["store"]: r["status"] for r in results}
    assert statuses.get("stone_oak") == LOG_STATUS_ERROR


# ── Log human-readable ────────────────────────────────────────────────────────

def test_markdown_log_is_human_readable(tmp_path):
    qbw = tmp_path / "test.qbw"
    qbw.write_text("fake")
    mock_cls = MagicMock()

    with (
        patch("services.qb_activity_log_service.QBClient", mock_cls),
        _patch_all_queries(),
    ):
        generate_activity_log(
            {"code": "bandera", "name": "Bandera", "bank_accounts": ["Chase"]},
            str(qbw), tmp_path, date_str="2026-06-03",
        )

    md_path = tmp_path / "bandera" / "2026-06-03.md"
    assert md_path.exists()
    md = md_path.read_text()
    assert "# QB Activity Log" in md
    assert "Status:" in md
    assert "Company File:" in md


def test_json_log_is_machine_readable(tmp_path):
    qbw = tmp_path / "test.qbw"
    qbw.write_text("fake")
    mock_cls = MagicMock()

    with (
        patch("services.qb_activity_log_service.QBClient", mock_cls),
        _patch_all_queries(),
    ):
        generate_activity_log(
            {"code": "bandera", "name": "Bandera", "bank_accounts": []},
            str(qbw), tmp_path, date_str="2026-06-03",
        )

    json_path = tmp_path / "bandera" / "2026-06-03.json"
    data = json.loads(json_path.read_text())
    assert "store" in data
    assert "date" in data
    assert "status" in data
    assert "latest_activity" in data
    assert "warnings" in data
    assert "errors" in data
    assert "generated_at" in data


# ── No QB write operations ────────────────────────────────────────────────────

def test_no_qb_write_operations(tmp_path):
    """Absolutely no write methods on QBClient should be called."""
    qbw = tmp_path / "test.qbw"
    qbw.write_text("fake")
    mock_cls, instance = MagicMock(), MagicMock()
    mock_cls.return_value = instance

    with (
        patch("services.qb_activity_log_service.QBClient", mock_cls),
        _patch_all_queries(),
    ):
        generate_activity_log(
            {"code": "bandera", "name": "Bandera", "bank_accounts": []},
            str(qbw), tmp_path, date_str="2026-06-03",
        )

    write_methods = [
        "delete_transaction", "delete_transactions",
    ]
    for method in write_methods:
        assert not getattr(instance, method).called, f"{method} should never be called"


# ── Force regenerate ──────────────────────────────────────────────────────────

def test_manual_force_regenerate_overwrites_safely(tmp_path):
    """force=True produces a new log without corrupting the existing one."""
    store_dir = tmp_path / "bandera"
    store_dir.mkdir()
    original = {"store": "bandera", "date": "2026-06-03", "status": "OLD_DATA"}
    (store_dir / "2026-06-03.json").write_text(json.dumps(original), encoding="utf-8")

    qbw = tmp_path / "test.qbw"
    qbw.write_text("fake")
    mock_cls = MagicMock()

    with (
        patch("services.qb_activity_log_service.QBClient", mock_cls),
        _patch_all_queries(),
    ):
        result = generate_activity_log(
            {"code": "bandera", "name": "Bandera", "bank_accounts": []},
            str(qbw), tmp_path, date_str="2026-06-03", force=True,
        )

    # File updated
    new_data = json.loads((store_dir / "2026-06-03.json").read_text())
    assert new_data.get("status") != "OLD_DATA"
    # Result is valid
    assert result["store"] == "bandera"
    assert result["status"] in (LOG_STATUS_PASS, LOG_STATUS_WARNING)
