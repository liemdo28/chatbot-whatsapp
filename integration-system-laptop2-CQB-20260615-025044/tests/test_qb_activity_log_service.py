"""
Tests for services/qb_activity_log_service.py

All QB COM calls are mocked. Tests verify:
- JSON + MD files are created correctly
- Groups by store and date
- Missing data becomes WARNING, not crash
- QB connection failure becomes ERROR log
- Duplicate guard prevents re-run
- Force flag overrides duplicate guard
- Read-only mode never calls QB write functions
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
    already_logged,
    load_qb_activity_config,
    _build_markdown,
    _determine_status,
    LOG_STATUS_PASS,
    LOG_STATUS_WARNING,
    LOG_STATUS_ERROR,
    LOG_STATUS_SKIPPED,
)


# ── Config loading ────────────────────────────────────────────────────────────

def test_load_qb_activity_config_defaults():
    cfg = load_qb_activity_config({})
    assert cfg["enabled"] is True
    assert cfg["daily_time"] == "09:15"
    assert cfg["output_dir"] == "logs/qb-activity"
    assert "sales_receipt" in cfg["include_transaction_types"]


def test_load_qb_activity_config_custom():
    raw = {
        "qb_activity_log": {
            "enabled": False,
            "daily_time": "08:00",
            "output_dir": "custom/logs",
            "stores": [{"code": "bandera"}],
        }
    }
    cfg = load_qb_activity_config(raw)
    assert cfg["enabled"] is False
    assert cfg["daily_time"] == "08:00"
    assert cfg["output_dir"] == "custom/logs"
    assert cfg["stores"][0]["code"] == "bandera"


# ── Status determination ──────────────────────────────────────────────────────

def test_determine_status_pass():
    assert _determine_status([], []) == LOG_STATUS_PASS

def test_determine_status_warning():
    assert _determine_status([], ["some warning"]) == LOG_STATUS_WARNING

def test_determine_status_error():
    assert _determine_status(["some error"], []) == LOG_STATUS_ERROR


# ── Duplicate guard ───────────────────────────────────────────────────────────

def test_already_logged_false_when_no_file(tmp_path):
    assert already_logged(tmp_path, "bandera", "2026-06-03") is False


def test_already_logged_true_when_file_exists(tmp_path):
    store_dir = tmp_path / "bandera"
    store_dir.mkdir()
    (store_dir / "2026-06-03.json").write_text("{}", encoding="utf-8")
    assert already_logged(tmp_path, "bandera", "2026-06-03") is True


# ── Markdown builder ──────────────────────────────────────────────────────────

def test_build_markdown_contains_key_fields():
    log = {
        "store": "bandera",
        "store_name": "Bakudan Bandera",
        "date": "2026-06-03",
        "quickbooks_company_file": "Bandera.qbw",
        "generated_at": "2026-06-03T09:15:00",
        "status": "PASS",
        "latest_activity": {
            "sales_receipt": {
                "found": True,
                "last_txn_date": "2026-06-02",
                "ref_number": "12345",
                "amount": 120.50,
                "customer": "Toast Sales",
                "class_name": "Bandera",
                "status": "FOUND",
                "warning": None,
                "error": None,
            }
        },
        "warnings": [],
        "errors": [],
    }
    md = _build_markdown(log)
    assert "Bakudan Bandera" in md
    assert "2026-06-03" in md
    assert "PASS" in md
    assert "2026-06-02" in md
    assert "$120.50" in md
    assert "Bandera.qbw" in md
    # Check no raw Python None appears in field values (only "None" in Warnings section is ok)
    for line in md.split("\n"):
        if "None" in line and not line.startswith("None") and "**" not in line:
            # A value field should not print Python None
            assert False, f"Found raw None in markdown field line: {repr(line)}"


def test_build_markdown_warnings_section():
    log = {
        "store": "x", "store_name": "X", "date": "2026-06-03",
        "quickbooks_company_file": "x.qbw", "generated_at": "", "status": "WARNING",
        "latest_activity": {},
        "warnings": ["No bank feed data found"],
        "errors": [],
    }
    md = _build_markdown(log)
    assert "No bank feed data found" in md
    assert "Warnings" in md


def test_build_markdown_errors_section():
    log = {
        "store": "x", "store_name": "X", "date": "2026-06-03",
        "quickbooks_company_file": "x.qbw", "generated_at": "", "status": "ERROR",
        "latest_activity": {},
        "warnings": [],
        "errors": ["QB connection failed"],
    }
    md = _build_markdown(log)
    assert "QB connection failed" in md
    assert "Errors" in md


# ── generate_activity_log ─────────────────────────────────────────────────────

def _fake_query_result(date="2026-06-02", found=True):
    return {
        "found": found,
        "last_txn_date": date if found else None,
        "ref_number": "REF-001" if found else None,
        "amount": 100.0 if found else None,
        "customer": "Toast Sales" if found else None,
        "class_name": "Bandera" if found else None,
        "account": None,
        "memo": None,
        "cleared": None,
        "txn_id": "TXN001" if found else None,
        "extra": {},
        "warning": None if found else "No data found.",
        "error": None,
    }


def _patch_queries(found=True):
    """Return a context manager that patches all QB activity queries."""
    q = _fake_query_result(found=found)
    return patch.multiple(
        "services.qb_activity_queries",
        get_latest_sales_receipt=MagicMock(return_value=q),
        get_latest_invoice=MagicMock(return_value=q),
        get_latest_payment=MagicMock(return_value=q),
        get_latest_deposit=MagicMock(return_value=q),
        get_latest_journal_entry=MagicMock(return_value=q),
        get_latest_bill=MagicMock(return_value=q),
        get_latest_bank_transaction=MagicMock(return_value=q),
        get_latest_reconcile_status=MagicMock(return_value=q),
    )


def _mock_qb_client():
    """Mock QBClient that connects/disconnects without COM."""
    mock_cls = MagicMock()
    instance = MagicMock()
    mock_cls.return_value = instance
    return mock_cls, instance


def test_generate_activity_log_creates_json_and_md(tmp_path):
    store_cfg = {
        "code": "bandera", "name": "Bakudan Bandera",
        "class_name": "Bandera", "customer_name": "Toast Sales",
        "bank_accounts": ["Chase Checking"],
    }
    qbw = tmp_path / "Bandera.qbw"
    qbw.write_text("fake")

    mock_cls, _ = _mock_qb_client()
    with (
        patch("services.qb_activity_log_service.QBClient", mock_cls),
        _patch_queries(found=True),
    ):
        result = generate_activity_log(
            store_cfg, str(qbw), tmp_path,
            date_str="2026-06-03",
        )

    # JSON file
    json_path = tmp_path / "bandera" / "2026-06-03.json"
    assert json_path.exists(), "JSON log not created"
    log_data = json.loads(json_path.read_text())
    assert log_data["store"] == "bandera"
    assert log_data["date"] == "2026-06-03"
    assert log_data["status"] in (LOG_STATUS_PASS, LOG_STATUS_WARNING)

    # Markdown file
    md_path = tmp_path / "bandera" / "2026-06-03.md"
    assert md_path.exists(), "Markdown log not created"
    md = md_path.read_text()
    assert "Bakudan Bandera" in md
    assert "2026-06-03" in md

    # Return dict
    assert result["store"] == "bandera"
    assert "latest_activity" in result


def test_generate_activity_log_grouped_by_store_and_date(tmp_path):
    """Two stores → two separate subdirectories."""
    qbw = tmp_path / "test.qbw"
    qbw.write_text("fake")
    mock_cls, _ = _mock_qb_client()

    with (
        patch("services.qb_activity_log_service.QBClient", mock_cls),
        _patch_queries(found=True),
    ):
        generate_activity_log(
            {"code": "bandera", "name": "Bandera", "bank_accounts": []},
            str(qbw), tmp_path, date_str="2026-06-03",
        )
        generate_activity_log(
            {"code": "stone_oak", "name": "Stone Oak", "bank_accounts": []},
            str(qbw), tmp_path, date_str="2026-06-03",
        )

    assert (tmp_path / "bandera" / "2026-06-03.json").exists()
    assert (tmp_path / "stone_oak" / "2026-06-03.json").exists()


def test_generate_activity_log_missing_data_is_warning_not_crash(tmp_path):
    """Missing bank/reconcile data → WARNING status, not exception."""
    qbw = tmp_path / "test.qbw"
    qbw.write_text("fake")
    mock_cls, _ = _mock_qb_client()
    warning_q = {**_fake_query_result(found=False), "warning": "No bank transactions found."}

    with (
        patch("services.qb_activity_log_service.QBClient", mock_cls),
        patch.multiple(
            "services.qb_activity_queries",
            get_latest_sales_receipt=MagicMock(return_value=_fake_query_result(found=True)),
            get_latest_invoice=MagicMock(return_value=_fake_query_result(found=True)),
            get_latest_payment=MagicMock(return_value=_fake_query_result(found=True)),
            get_latest_deposit=MagicMock(return_value=_fake_query_result(found=True)),
            get_latest_journal_entry=MagicMock(return_value=_fake_query_result(found=True)),
            get_latest_bill=MagicMock(return_value=_fake_query_result(found=True)),
            get_latest_bank_transaction=MagicMock(return_value=warning_q),
            get_latest_reconcile_status=MagicMock(return_value=warning_q),
        ),
    ):
        result = generate_activity_log(
            {"code": "bandera", "name": "Bandera", "bank_accounts": ["Chase Checking"]},
            str(qbw), tmp_path, date_str="2026-06-03",
        )

    assert result["status"] == LOG_STATUS_WARNING
    assert len(result["warnings"]) > 0


def test_generate_activity_log_qb_connection_failure_is_error(tmp_path):
    """QB connection failure → ERROR status, log still written."""
    qbw = tmp_path / "test.qbw"
    qbw.write_text("fake")
    mock_cls = MagicMock()
    mock_cls.return_value.connect.side_effect = RuntimeError("QB not available")

    with patch("services.qb_activity_log_service.QBClient", mock_cls):
        result = generate_activity_log(
            {"code": "bandera", "name": "Bandera", "bank_accounts": []},
            str(qbw), tmp_path, date_str="2026-06-03",
        )

    assert result["status"] == LOG_STATUS_ERROR
    assert len(result["errors"]) > 0
    # File is still written even on error
    assert (tmp_path / "bandera" / "2026-06-03.json").exists()


def test_generate_activity_log_duplicate_guard(tmp_path):
    """Second run same store/date skips without calling QB."""
    store_dir = tmp_path / "bandera"
    store_dir.mkdir()
    existing = {"store": "bandera", "date": "2026-06-03", "status": "PASS"}
    (store_dir / "2026-06-03.json").write_text(json.dumps(existing), encoding="utf-8")

    mock_cls = MagicMock()
    with patch("services.qb_activity_log_service.QBClient", mock_cls):
        result = generate_activity_log(
            {"code": "bandera", "name": "Bandera", "bank_accounts": []},
            str(tmp_path / "fake.qbw"), tmp_path, date_str="2026-06-03",
        )

    # QB should NOT have been called
    mock_cls.assert_not_called()
    assert result.get("status") in ("PASS", "SKIPPED")


def test_generate_activity_log_force_overwrites(tmp_path):
    """force=True overwrites existing log."""
    store_dir = tmp_path / "bandera"
    store_dir.mkdir()
    old = {"store": "bandera", "date": "2026-06-03", "status": "OLD"}
    (store_dir / "2026-06-03.json").write_text(json.dumps(old), encoding="utf-8")
    qbw = tmp_path / "test.qbw"
    qbw.write_text("fake")
    mock_cls, _ = _mock_qb_client()

    with (
        patch("services.qb_activity_log_service.QBClient", mock_cls),
        _patch_queries(found=True),
    ):
        result = generate_activity_log(
            {"code": "bandera", "name": "Bandera", "bank_accounts": []},
            str(qbw), tmp_path, date_str="2026-06-03", force=True,
        )

    assert result.get("status") != "OLD"  # was overwritten
    mock_cls.assert_called_once()          # QB was called


def test_generate_activity_log_read_only(tmp_path):
    """Verify no QB write/delete/modify functions are called."""
    qbw = tmp_path / "test.qbw"
    qbw.write_text("fake")
    mock_cls, instance = _mock_qb_client()

    with (
        patch("services.qb_activity_log_service.QBClient", mock_cls),
        _patch_queries(found=True),
    ):
        generate_activity_log(
            {"code": "bandera", "name": "Bandera", "bank_accounts": []},
            str(qbw), tmp_path, date_str="2026-06-03",
        )

    # These write methods must NEVER be called
    assert not instance.delete_transaction.called
    assert not instance.delete_transactions.called


def test_output_folder_created_automatically(tmp_path):
    """Output directory is created if it does not exist."""
    output = tmp_path / "deep" / "nested" / "logs"
    assert not output.exists()
    qbw = tmp_path / "test.qbw"
    qbw.write_text("fake")
    mock_cls, _ = _mock_qb_client()

    with (
        patch("services.qb_activity_log_service.QBClient", mock_cls),
        _patch_queries(found=True),
    ):
        generate_activity_log(
            {"code": "bandera", "name": "Bandera", "bank_accounts": []},
            str(qbw), output, date_str="2026-06-03",
        )

    assert (output / "bandera" / "2026-06-03.json").exists()
