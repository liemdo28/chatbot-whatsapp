from decimal import Decimal
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
DESKTOP_APP = ROOT / "desktop-app"
if str(DESKTOP_APP) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP))


def test_run_qb_sync_blocks_when_write_flag_disabled(monkeypatch):
    from services import feature_flags
    from services.qb_sync_service import run_qb_sync

    monkeypatch.setattr(feature_flags, "qb_write_sync_enabled", lambda: False)

    result = run_qb_sync(["Stockton"], "2026-06-14", "2026-06-14")

    assert result["ok"] is False
    assert result["success_count"] == 0
    assert result["fail_count"] == 0
    assert "QB write sync is disabled" in result["warnings"][0]
    assert result["finished_at"]


def test_run_qb_sync_uses_existing_qb_client_api(monkeypatch, tmp_path):
    import qb_sync
    from services import feature_flags
    from services import qb_sync_service

    calls = []
    prep_calls = []
    report_path = tmp_path / "SalesSummary_2026-06-14_2026-06-14.xlsx"
    report_path.write_bytes(b"placeholder")

    mapping = {
        "global": {"app_name": "Test Sync", "qbxml_version": "13.0"},
        "stores": {
            "Stockton": {
                "toast_location": "Stockton",
                "customer_name": "Toasttab",
                "sale_no_prefix": "",
            }
        },
    }

    class FakeReader:
        def __init__(self, path):
            self.path = Path(path)

        def close(self):
            calls.append(("reader.close", str(self.path)))

    class FakeClient:
        def __init__(self, app_name="Toast Report Sync", qbxml_version="13.0"):
            calls.append(("init", app_name, qbxml_version))

        def connect(self):
            calls.append(("connect",))

        def check_exists(self, txn_date, ref_number):
            calls.append(("check_exists", txn_date, ref_number))
            return False

        def ensure_customer(self, customer_name):
            calls.append(("ensure_customer", customer_name))
            return True

        def create_sales_receipt(self, txn_date, ref_number, customer_name, memo, lines, class_name=None):
            calls.append(("create_sales_receipt", txn_date, ref_number, customer_name, len(lines), class_name))
            return {"success": True, "txn_id": "TXN-1"}

        def disconnect(self):
            calls.append(("disconnect",))

    monkeypatch.setattr(feature_flags, "qb_write_sync_enabled", lambda: True)
    monkeypatch.setattr(
        qb_sync_service,
        "_load_runtime_config",
        lambda: {"qbw_paths": {"raw-stockton": "C:\\QB Data\\Raw Stockton\\rawstockton.qbw"}},
    )
    monkeypatch.setattr(
        qb_sync_service,
        "_ensure_qb_company_ready",
        lambda **kwargs: prep_calls.append(kwargs) or (True, ""),
    )
    monkeypatch.setattr(qb_sync, "load_mapping", lambda: mapping)
    monkeypatch.setattr(qb_sync, "load_csv_mapping", lambda store, cfg: cfg)
    monkeypatch.setattr(
        qb_sync,
        "find_report_file",
        lambda store, cfg, date: [{"location": "Stockton", "filepath": report_path}],
    )
    monkeypatch.setattr(qb_sync, "ToastExcelReader", FakeReader)
    monkeypatch.setattr(
        qb_sync,
        "extract_receipt_lines",
        lambda reader, cfg, issues=None: [
            {"item_name": "Toast:Food Sales", "amount": Decimal("10.00"), "desc": "Food"}
        ],
    )
    monkeypatch.setattr(qb_sync, "has_blocking_issues", lambda issues: False)
    monkeypatch.setattr(qb_sync, "QBSyncClient", FakeClient)

    result = qb_sync_service.run_qb_sync(["raw-stockton"], "2026-06-14", "2026-06-14")

    assert result["ok"] is True
    assert result["success_count"] == 1
    assert result["entry_count"] == 1
    assert result["total_amount"] == 10.0
    assert prep_calls and prep_calls[0]["qbw_path"] == "C:\\QB Data\\Raw Stockton\\rawstockton.qbw"
    assert ("check_exists", "2026-06-14", "20260614") in calls
    assert ("create_sales_receipt", "2026-06-14", "20260614", "Toasttab", 1, None) in calls
    assert ("disconnect",) in calls


def test_run_qb_sync_blocks_when_qb_company_cannot_be_prepared(monkeypatch):
    from services import feature_flags
    from services import qb_sync_service

    monkeypatch.setattr(feature_flags, "qb_write_sync_enabled", lambda: True)
    monkeypatch.setattr(
        qb_sync_service,
        "_load_runtime_config",
        lambda: {"qbw_paths": {"Stockton": "C:\\QB Data\\Raw Stockton\\rawstockton.qbw"}},
    )
    monkeypatch.setattr(
        qb_sync_service,
        "_ensure_qb_company_ready",
        lambda **kwargs: (False, "QuickBooks did not close cleanly before switching company files"),
    )

    import qb_sync

    monkeypatch.setattr(
        qb_sync,
        "load_mapping",
        lambda: {
            "stores": {
                "Stockton": {
                    "toast_location": "Stockton",
                    "customer_name": "Toasttab",
                }
            }
        },
    )
    monkeypatch.setattr(qb_sync, "load_csv_mapping", lambda store, cfg: cfg)

    result = qb_sync_service.run_qb_sync(["Stockton"], "2026-06-14", "2026-06-14")

    assert result["ok"] is False
    assert result["success_count"] == 0
    assert result["fail_count"] == 1
    assert any("did not close cleanly" in warning for warning in result["warnings"])
