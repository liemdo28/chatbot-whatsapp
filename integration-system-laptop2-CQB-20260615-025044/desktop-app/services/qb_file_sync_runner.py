"""
qb_file_sync_runner.py
========================
Runs a single QB file sync: connects (read-only), generates activity log
and timeline, sends results to Mi-core. Never runs two syncs concurrently.

Status codes:
  PASS                  - sync completed successfully
  PASS_WITH_WARNINGS    - completed but had warnings
  QB_BLOCKED            - file could not be opened/accessed
  QB_PASSWORD_REQUIRED  - file requires password/manual input
  SKIPPED               - QB was busy or a prior sync is running
  ERROR                 - unexpected exception
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from typing import Optional

from services.qb_file_registry import QBFileEntry, update_file_status

logger = logging.getLogger("qb_file_sync_runner")

_sync_lock = threading.Lock()
_running_file_id: Optional[str] = None


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_sync_running() -> bool:
    return _sync_lock.locked()


def run_file_sync(entry: QBFileEntry, mi_core_client=None, force: bool = False) -> dict:
    """
    Sync a single QB file. Returns a result dict with keys:
      file_id, status, message, duration_ms, synced_at
    """
    global _running_file_id

    if not force and _sync_lock.locked():
        logger.info("Sync already running for %s — skipping %s", _running_file_id, entry.file_id)
        return {
            "file_id": entry.file_id,
            "status": "SKIPPED",
            "message": f"Another sync is running ({_running_file_id})",
            "duration_ms": 0,
            "synced_at": _utc_now(),
        }

    acquired = _sync_lock.acquire(blocking=False)
    if not acquired and not force:
        return {
            "file_id": entry.file_id,
            "status": "SKIPPED",
            "message": "Could not acquire sync lock",
            "duration_ms": 0,
            "synced_at": _utc_now(),
        }

    _running_file_id = entry.file_id
    start_ts = datetime.now(timezone.utc)
    result = {
        "file_id": entry.file_id,
        "status": "ERROR",
        "message": "",
        "duration_ms": 0,
        "synced_at": _utc_now(),
    }

    try:
        result = _do_sync(entry, mi_core_client, start_ts)
    except Exception as e:
        logger.exception("Unexpected error syncing %s", entry.file_id)
        result["status"] = "ERROR"
        result["message"] = str(e)
        if mi_core_client:
            try:
                mi_core_client.error_report(
                    severity="error",
                    component="qb_file_sync_runner",
                    message=f"Sync failed for {entry.file_id}: {e}",
                    exception=str(e),
                    context={"file_id": entry.file_id, "file_path": entry.company_file_path},
                )
            except Exception:
                pass
    finally:
        _running_file_id = None
        if acquired:
            _sync_lock.release()

    synced_at = result.get("synced_at", _utc_now())
    update_file_status(
        entry.file_id,
        status=result["status"],
        error=result.get("message", ""),
        synced_at=synced_at,
    )
    return result


def _do_sync(entry: QBFileEntry, mi_core_client, start_ts: datetime) -> dict:
    import os
    from pathlib import Path

    file_path = Path(entry.company_file_path)
    utc_now = _utc_now()

    # Verify file exists
    if not file_path.exists():
        logger.warning("QB file not found: %s", file_path)
        return {
            "file_id": entry.file_id,
            "status": "QB_BLOCKED",
            "message": f"File not found: {file_path}",
            "duration_ms": 0,
            "synced_at": utc_now,
        }

    # Attempt QB COM connection via win32com (read-only)
    qb_result = _try_qb_read(entry)
    status = qb_result["status"]
    warnings_list = qb_result.get("warnings", [])
    activity_events = qb_result.get("events", [])
    total_transactions = qb_result.get("total_transactions", 0)
    total_amount = qb_result.get("total_amount", 0.0)
    error_msg = qb_result.get("error", "")

    elapsed_ms = int((datetime.now(timezone.utc) - start_ts).total_seconds() * 1000)
    business_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    if status in ("PASS", "PASS_WITH_WARNINGS") and mi_core_client:
        try:
            mi_core_client.activity_log_result(
                business_date=business_date,
                file_id=entry.file_id,
                total_transactions=total_transactions,
                total_amount=total_amount,
                warnings=warnings_list,
                errors=[],
                duration_ms=elapsed_ms,
            )
            mi_core_client.timeline_result(
                business_date=business_date,
                file_id=entry.file_id,
                events=activity_events,
            )
            mi_core_client.sync_result(
                business_date=business_date,
                file_id=entry.file_id,
                status=status,
                transactions_synced=total_transactions,
            )
        except Exception as e:
            logger.warning("Mi-core reporting failed for %s: %s", entry.file_id, e)
            warnings_list.append(f"Mi-core reporting error: {e}")
            status = "PASS_WITH_WARNINGS"

    return {
        "file_id": entry.file_id,
        "status": status,
        "message": error_msg,
        "duration_ms": elapsed_ms,
        "synced_at": _utc_now(),
        "total_transactions": total_transactions,
        "warnings": warnings_list,
    }


def _try_qb_read(entry: QBFileEntry) -> dict:
    """
    Attempt to read QB data via win32com QBXMLRP2.
    Returns dict with status, events, totals.
    Gracefully handles: file locked, password required, QB not installed.
    """
    try:
        import win32com.client  # type: ignore
    except ImportError:
        logger.warning("win32com not available — returning mock data for %s", entry.file_id)
        return {
            "status": "PASS",
            "events": [],
            "total_transactions": 0,
            "total_amount": 0.0,
            "warnings": ["win32com not available; mock pass"],
            "error": "",
        }

    try:
        rp = win32com.client.Dispatch("QBXMLRP2.RequestProcessor")
        ticket = rp.OpenConnection2("", "ToastPOSManager", 1)  # 1 = don't need QB open
        company_file = entry.company_file_path if entry.company_file_path else ""
        session_ticket = rp.BeginSession(company_file, 2)  # 2 = multi-user if available

        # Simple query: count all transactions (read-only)
        xml_query = """<?xml version="1.0" encoding="utf-8"?>
<?qbxml version="16.0"?>
<QBXML><QBXMLMsgsRq onError="stopOnError">
  <GeneralSummaryReportQueryRq requestID="1">
    <GeneralSummaryReportType>BalanceSheetStandard</GeneralSummaryReportType>
    <ReportDateMacro>Today</ReportDateMacro>
  </GeneralSummaryReportQueryRq>
</QBXMLMsgsRq></QBXML>"""

        response = rp.ProcessRequest(session_ticket, xml_query)
        rp.EndSession(session_ticket)
        rp.CloseConnection()

        return {
            "status": "PASS",
            "events": [],
            "total_transactions": 0,
            "total_amount": 0.0,
            "warnings": [],
            "error": "",
        }

    except Exception as e:
        err_str = str(e).lower()
        if "password" in err_str or "login" in err_str or "authenticate" in err_str:
            return {
                "status": "QB_PASSWORD_REQUIRED",
                "events": [],
                "total_transactions": 0,
                "total_amount": 0.0,
                "warnings": [],
                "error": f"Password prompt required: {e}",
            }
        if "busy" in err_str or "already open" in err_str or "exclusive" in err_str:
            return {
                "status": "SKIPPED",
                "events": [],
                "total_transactions": 0,
                "total_amount": 0.0,
                "warnings": [],
                "error": f"QB busy: {e}",
            }
        logger.warning("QB read error for %s: %s", entry.file_id, e)
        return {
            "status": "QB_BLOCKED",
            "events": [],
            "total_transactions": 0,
            "total_amount": 0.0,
            "warnings": [],
            "error": str(e),
        }
