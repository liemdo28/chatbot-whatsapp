"""Service layer for QB sales receipt sync workflow."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path


def _normalize_key(value: str) -> str:
    return "".join(ch.lower() for ch in str(value or "") if ch.isalnum())


def _store_alias_match(a: str, b: str) -> bool:
    left = _normalize_key(a)
    right = _normalize_key(b)
    return bool(left and right and (left == right or left in right or right in left))


def _lookup_store_config(mapping: dict, store: str) -> tuple[str, dict]:
    stores = dict(mapping.get("stores") or {})
    if store in stores:
        return store, dict(stores[store] or {})
    for name, cfg in stores.items():
        if _store_alias_match(store, name):
            return name, dict(cfg or {})
    return store, {}


def _resolve_qbw_path(config: dict, store: str) -> str:
    qbw_paths = dict(config.get("qbw_paths") or {})
    if qbw_paths.get(store):
        return str(qbw_paths[store])
    for name, path in qbw_paths.items():
        if path and _store_alias_match(store, name):
            return str(path)
    qb_cfg = dict(config.get("quickbooks") or {})
    return str(qb_cfg.get("company_file") or "")


def _load_runtime_config() -> dict:
    try:
        import json
        from app_paths import RUNTIME_DIR

        cfg_path = RUNTIME_DIR / "local-config.json"
        if cfg_path.exists():
            return json.loads(cfg_path.read_text(encoding="utf-8-sig"))
    except Exception:
        pass
    return {}


def _line_total(lines: list[dict]) -> float:
    total = Decimal("0")
    for line in lines:
        amount = line.get("amount", Decimal("0"))
        if amount > 0:
            total += amount
    return float(total)


def _issue_lines(issues: list) -> list[str]:
    lines = []
    for issue in issues:
        if hasattr(issue, "format_line"):
            lines.append(issue.format_line())
        else:
            lines.append(str(issue))
    return lines


def _find_local_report(qb_sync, store_name: str, store_config: dict, date_iso: str) -> Path | None:
    matches = qb_sync.find_report_file(store_name, store_config, date_iso)
    if matches:
        return Path(matches[0]["filepath"])
    return None


def _download_drive_report(store_name: str, date_display: str):
    try:
        from gdrive_service import GDriveService

        drive = GDriveService()
        local_path = drive.download_report(store_name, "sales_summary", date_display)
        return Path(local_path) if local_path else None
    except Exception:
        return None


def _ensure_qb_company_ready(
    *,
    store_name: str,
    store_config: dict,
    qbw_path: str,
    on_log,
) -> tuple[bool, str]:
    try:
        from qb_automate import (
            close_qb_completely,
            get_last_qb_automation_error,
            open_store,
            validate_company_file_path,
        )
    except Exception as exc:
        return False, f"QB automation is unavailable: {exc}"

    qbw_match = store_config.get("qbw_match")
    file_ok, file_msg = validate_company_file_path(qbw_path, qbw_match, store_name)
    if not file_ok:
        return False, file_msg

    on_log(f"  {file_msg}")
    on_log(f"  Opening QuickBooks company file: {Path(qbw_path).name}")

    if not close_qb_completely(callback=on_log):
        return False, "QuickBooks did not close cleanly before switching company files"

    opened = open_store(
        store_name,
        {store_name: qbw_path},
        qbw_match=qbw_match,
        password_key=store_config.get("password") or "pass1",
    )
    if not opened:
        detail = get_last_qb_automation_error()
        if detail:
            return False, detail
        return False, f"Failed to open QuickBooks company file: {Path(qbw_path).name}"

    return True, ""


def _sync_single_date(
    *,
    qb_sync,
    store_name: str,
    store_config: dict,
    qbw_path: str,
    date_iso: str,
    on_log,
) -> dict:
    report_path = _find_local_report(qb_sync, store_name, store_config, date_iso)
    if report_path is None:
        date_display = datetime.strptime(date_iso, "%Y-%m-%d").strftime("%m/%d/%Y")
        report_path = _download_drive_report(store_name, date_display)

    if report_path is None:
        return {"ok": False, "error": "Sales summary report not found"}

    issues = []
    reader = qb_sync.ToastExcelReader(report_path)
    try:
        lines = qb_sync.extract_receipt_lines(reader, store_config, issues)
    finally:
        reader.close()

    if not lines:
        return {"ok": False, "error": "No receipt lines extracted from report"}

    warnings = _issue_lines(issues)
    if qb_sync.has_blocking_issues(issues):
        return {
            "ok": False,
            "error": "Preflight validation blocked live sync",
            "warnings": warnings,
        }

    mapping = qb_sync.load_mapping()
    global_cfg = dict(mapping.get("global") or {})
    client = qb_sync.QBSyncClient(
        app_name=global_cfg.get("app_name") or "Toast Report Sync",
        qbxml_version=global_cfg.get("qbxml_version") or "13.0",
    )

    txn_date = date_iso
    ref_number = f"{store_config.get('sale_no_prefix', '')}{date_iso.replace('-', '')}"
    customer_name = store_config.get("customer_name") or "Toasttab"
    class_name = store_config.get("class_name") or None
    memo = f"Toast Sales {store_name} {date_iso}"

    on_log(f"    Using QB company file: {qbw_path}")
    client.connect()
    try:
        if client.check_exists(txn_date, ref_number):
            return {
                "ok": True,
                "skipped": True,
                "receipt_count": 0,
                "total_amount": 0.0,
                "warnings": warnings + [f"Sales receipt already exists: {ref_number}"],
            }

        if not client.ensure_customer(customer_name):
            return {
                "ok": False,
                "error": f"Could not ensure QB customer: {customer_name}",
                "warnings": warnings,
            }

        receipt = client.create_sales_receipt(
            txn_date,
            ref_number,
            customer_name,
            memo,
            lines,
            class_name=class_name,
        )
    finally:
        client.disconnect()

    if not receipt.get("success"):
        return {
            "ok": False,
            "error": receipt.get("error") or "QuickBooks rejected sales receipt",
            "warnings": warnings,
        }

    return {
        "ok": True,
        "receipt_count": 1,
        "total_amount": _line_total(lines),
        "txn_id": receipt.get("txn_id", ""),
        "warnings": warnings,
    }


def run_qb_sync(
    stores: list,
    date_start: str,
    date_end: str,
    on_progress=None,
    stop_event=None,
) -> dict:
    """Run live QB sync. Returns result dict."""
    result = {
        "ok": False,
        "success_count": 0,
        "fail_count": 0,
        "warnings": [],
        "entry_count": 0,
        "total_amount": 0.0,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "finished_at": "",
    }

    def _log(msg):
        if callable(on_progress):
            on_progress(msg)

    try:
        from services.feature_flags import qb_write_sync_enabled

        if not qb_write_sync_enabled():
            result["warnings"].append("QB write sync is disabled in local-config.json")
            _log("QB write sync is disabled; no sales receipts were written.")
            return result

        import qb_sync

        config = _load_runtime_config()
        mapping = qb_sync.load_mapping()
        if not mapping.get("stores"):
            result["warnings"].append("QB mapping file has no stores configured")
            return result

        s = datetime.strptime(date_start, "%Y-%m-%d").date()
        e = datetime.strptime(date_end, "%Y-%m-%d").date()

        for requested_store in stores:
            if stop_event and stop_event.is_set():
                _log(f"Stopped before {requested_store}")
                break

            store_name, store_config = _lookup_store_config(mapping, requested_store)
            if not store_config:
                result["warnings"].append(f"{requested_store}: No QB mapping configured")
                result["fail_count"] += 1
                continue
            store_config = qb_sync.load_csv_mapping(store_name, store_config)

            qbw_path = _resolve_qbw_path(config, requested_store)
            if not qbw_path:
                qbw_path = _resolve_qbw_path(config, store_name)
            if not qbw_path:
                result["warnings"].append(f"{requested_store}: No QB company file configured")
                result["fail_count"] += 1
                _log(f"{requested_store}: Skipped - no QB company file configured")
                continue

            ready, ready_error = _ensure_qb_company_ready(
                store_name=store_name,
                store_config=store_config,
                qbw_path=qbw_path,
                on_log=_log,
            )
            if not ready:
                result["warnings"].append(f"{requested_store}: {ready_error}")
                result["fail_count"] += 1
                _log(f"{requested_store}: Skipped - {ready_error}")
                continue

            _log(f"Syncing {store_name}...")
            cur = s
            while cur <= e:
                if stop_event and stop_event.is_set():
                    break
                date_iso = cur.isoformat()
                _log(f"  {store_name} / {date_iso}...")
                try:
                    sync_res = _sync_single_date(
                        qb_sync=qb_sync,
                        store_name=store_name,
                        store_config=store_config,
                        qbw_path=qbw_path,
                        date_iso=date_iso,
                        on_log=_log,
                    )
                    result["warnings"].extend(
                        f"{store_name}/{date_iso}: {warning}"
                        for warning in sync_res.get("warnings", [])
                    )
                    if sync_res.get("ok"):
                        result["success_count"] += 1
                        result["entry_count"] += int(sync_res.get("receipt_count", 0))
                        result["total_amount"] += float(sync_res.get("total_amount", 0.0))
                    else:
                        result["fail_count"] += 1
                        result["warnings"].append(
                            f"{store_name}/{date_iso}: {sync_res.get('error', 'sync failed')}"
                        )
                except Exception as exc:
                    result["fail_count"] += 1
                    result["warnings"].append(f"{store_name}/{date_iso}: {exc}")
                cur += timedelta(days=1)

        result["ok"] = result["fail_count"] == 0 and result["success_count"] > 0

    except Exception as exc:
        result["warnings"].append(f"QB sync engine error: {exc}")

    finally:
        result["finished_at"] = datetime.now(timezone.utc).isoformat()

    return result
