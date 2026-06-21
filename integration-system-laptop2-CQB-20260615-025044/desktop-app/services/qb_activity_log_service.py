"""
QB Activity Log Service
=======================
Connects to QB, runs all read-only activity queries, and writes per-store
per-day log files in JSON and Markdown.

Output structure:
    <output_dir>/<store_code>/<YYYY-MM-DD>.json
    <output_dir>/<store_code>/<YYYY-MM-DD>.md

Never modifies QB data.  Uses QBClient (QBXML COM) in read-only mode.
"""

from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

_log = logging.getLogger(__name__)

# ── Lazy top-level imports (patchable in tests) ───────────────────────────────
try:
    from qb_client import QBClient  # noqa: F401
except ImportError:
    QBClient = None  # type: ignore[assignment,misc]

try:
    from services import qb_activity_queries as _qb_queries  # noqa: F401
except ImportError:
    _qb_queries = None  # type: ignore[assignment]

# ── Status constants ──────────────────────────────────────────────────────────
LOG_STATUS_PASS    = "PASS"
LOG_STATUS_WARNING = "WARNING"
LOG_STATUS_ERROR   = "ERROR"
LOG_STATUS_SKIPPED = "SKIPPED"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _local_now_iso() -> str:
    return datetime.now().replace(microsecond=0).isoformat()


def _today_str() -> str:
    from datetime import date
    return date.today().isoformat()


def _perf_now_ms() -> float:
    """Return current time in milliseconds for performance tracking."""
    return datetime.now(timezone.utc).timestamp() * 1000


def _perf_ms(start_ms: float) -> float:
    """Return elapsed milliseconds since start_ms."""
    return _perf_now_ms() - start_ms


# ── Config loader ─────────────────────────────────────────────────────────────

def load_qb_activity_config(config: dict | None = None) -> dict:
    """
    Extract qb_activity_log block from local-config dict.
    Returns a safe dict with defaults.
    """
    if config is None:
        config = _load_local_config()
    raw = dict(config.get("qb_activity_log") or {})
    return {
        "enabled":          bool(raw.get("enabled", True)),
        "run_on_app_start": bool(raw.get("run_on_app_start", True)),
        "daily_time":       str(raw.get("daily_time") or "09:15"),
        "output_dir":       str(raw.get("output_dir") or "logs/qb-activity"),
        "stores":           list(raw.get("stores") or []),
        "include_transaction_types": list(
            raw.get("include_transaction_types") or [
                "sales_receipt", "invoice", "payment", "deposit",
                "journal_entry", "bill", "bank_transaction", "reconcile",
            ]
        ),
    }


def _load_local_config() -> dict:
    try:
        from app_paths import runtime_path
        p = runtime_path("local-config.json")
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8-sig"))
    except Exception as exc:
        _log.warning("Could not load local-config.json: %s", exc)
    return {}


# ── Log checkpoint (prevents duplicate runs) ──────────────────────────────────

def _checkpoint_path(output_dir: Path, store_code: str, date_str: str) -> Path:
    return output_dir / store_code / f"{date_str}.json"


def already_logged(output_dir: Path, store_code: str, date_str: str) -> bool:
    """Return True if a log already exists for this store/date."""
    return _checkpoint_path(output_dir, store_code, date_str).exists()


# ── Core log generation ────────────────────────────────────────────────────────

def generate_activity_log(
    store_cfg: dict,
    qbw_path: str,
    output_dir: Path | str,
    *,
    date_str: str | None = None,
    force: bool = False,
    include_types: list[str] | None = None,
    on_log: Optional[Callable[[str], None]] = None,
) -> dict:
    """
    Connect to QB company file, run read-only queries, write JSON + MD logs.

    Parameters
    ----------
    store_cfg : dict
        Store config block from qb_activity_log.stores[]:
          {code, name, class_name, customer_name, bank_accounts: [str]}
    qbw_path : str
        Path to the .qbw company file.
    output_dir : Path | str
        Root output directory. Store subdirs created automatically.
    date_str : str, optional
        "YYYY-MM-DD" — defaults to today.
    force : bool
        Overwrite existing log if True.
    include_types : list[str], optional
        Transaction types to query. Defaults to all.
    on_log : callable, optional
        Progress callback(msg: str).

    Returns
    -------
    dict : The activity log dict (same as written to JSON).
    """
    output_dir = Path(output_dir)
    date_str = date_str or _today_str()
    store_code = (store_cfg.get("code") or "unknown").lower()
    store_name = store_cfg.get("name") or store_code
    bank_accounts: list[str] = list(store_cfg.get("bank_accounts") or [])
    include_types = include_types or [
        "sales_receipt", "invoice", "payment", "deposit",
        "journal_entry", "bill", "bank_transaction", "reconcile",
    ]
    _t0 = _perf_now_ms()

    def emit(msg: str) -> None:
        _log.info("[QBActivityLog][%s] %s", store_code, msg)
        if callable(on_log):
            try:
                on_log(msg)
            except Exception:
                pass

    # ── Duplicate guard ───────────────────────────────────────────────
    if not force and already_logged(output_dir, store_code, date_str):
        emit(f"Log already exists for {store_code}/{date_str} — skipping (use force=True to overwrite).")
        return _load_existing_log(output_dir, store_code, date_str)

    # ── Connect to QB ─────────────────────────────────────────────────
    emit(f"Connecting to QB: {Path(qbw_path).name}")
    activity: dict = {}
    warnings: list[str] = []
    errors: list[str] = []
    client = None
    qb_connect_ms = 0
    qb_query_ms = 0
    json_write_ms = 0
    md_write_ms = 0

    try:
        _ClientCls = QBClient  # module-level (patchable)
        if _ClientCls is None:
            raise ImportError("qb_client not available on this machine")
        _t1 = _perf_now_ms()
        client = _ClientCls(app_name="Toast POS Manager - Activity Log")
        client.connect(qbw_path)
        qb_connect_ms = _perf_ms(_t1)
        emit(f"QB connected in {qb_connect_ms:.0f} ms.")

        Q = _qb_queries  # module-level (patchable)
        if Q is None:
            raise ImportError("qb_activity_queries not available")

        _t2 = _perf_now_ms()

        # ── Sales Receipt ─────────────────────────────────────────────
        if "sales_receipt" in include_types:
            emit("Querying: Sales Receipts...")
            sr = Q.get_latest_sales_receipt(client, days_back=90)
            activity["sales_receipt"] = _normalize_activity_entry(sr)
            _collect_diag(sr, "sales_receipt", warnings, errors)

        # ── Invoice ───────────────────────────────────────────────────
        if "invoice" in include_types:
            emit("Querying: Invoices...")
            inv = Q.get_latest_invoice(client, days_back=90)
            activity["invoice"] = _normalize_activity_entry(inv)
            _collect_diag(inv, "invoice", warnings, errors)

        # ── Payment ───────────────────────────────────────────────────
        if "payment" in include_types:
            emit("Querying: Payments...")
            pmt = Q.get_latest_payment(client, days_back=90)
            activity["payment"] = _normalize_activity_entry(pmt)
            _collect_diag(pmt, "payment", warnings, errors)

        # ── Deposit ───────────────────────────────────────────────────
        if "deposit" in include_types:
            emit("Querying: Deposits...")
            dep = Q.get_latest_deposit(client, days_back=90)
            activity["deposit"] = _normalize_activity_entry(dep)
            _collect_diag(dep, "deposit", warnings, errors)

        # ── Journal Entry ─────────────────────────────────────────────
        if "journal_entry" in include_types:
            emit("Querying: Journal Entries...")
            je = Q.get_latest_journal_entry(client, days_back=90)
            activity["journal_entry"] = _normalize_activity_entry(je)
            _collect_diag(je, "journal_entry", warnings, errors)

        # ── Bill ──────────────────────────────────────────────────────
        if "bill" in include_types:
            emit("Querying: Bills...")
            bill = Q.get_latest_bill(client, days_back=90)
            activity["bill"] = _normalize_activity_entry(bill)
            _collect_diag(bill, "bill", warnings, errors)

        # ── Bank Transactions (per account) ────────────────────────────
        if "bank_transaction" in include_types:
            activity["bank_transactions"] = []
            for acct in bank_accounts:
                emit(f"Querying: Bank Transactions for '{acct}'...")
                bt = Q.get_latest_bank_transaction(client, acct, days_back=90)
                entry = _normalize_activity_entry(bt)
                entry["account"] = acct
                activity["bank_transactions"].append(entry)
                _collect_diag(bt, f"bank_transaction[{acct}]", warnings, errors)
            if not bank_accounts:
                activity["bank_transactions"] = []
                warnings.append("No bank accounts configured for this store.")

        # ── Reconcile Status (per account) ────────────────────────────
        if "reconcile" in include_types:
            activity["reconcile"] = []
            for acct in bank_accounts:
                emit(f"Querying: Reconcile for '{acct}'...")
                rec = Q.get_latest_reconcile_status(client, acct, days_back=400)
                entry = _normalize_activity_entry(rec)
                entry["account"] = acct
                activity["reconcile"].append(entry)
                _collect_diag(rec, f"reconcile[{acct}]", warnings, errors)
            if not bank_accounts:
                activity["reconcile"] = []
                warnings.append("No bank accounts configured — cannot query reconcile status.")

        qb_query_ms = _perf_ms(_t2)

    except Exception as exc:
        error_msg = f"QB connection/query failed: {exc}"
        errors.append(error_msg)
        emit(f"ERROR: {error_msg}")
    finally:
        if client is not None:
            try:
                client.disconnect()
                emit("QB disconnected.")
            except Exception:
                pass

    # ── Build log dict ─────────────────────────────────────────────────
    status = _determine_status(errors, warnings)
    log_dict = {
        "store":                  store_code,
        "store_name":             store_name,
        "date":                   date_str,
        "quickbooks_company_file": Path(qbw_path).name,
        "quickbooks_company_path": str(qbw_path),
        "generated_at":            _local_now_iso(),
        "generated_at_utc":        _utc_now_iso(),
        "status":                 status,
        "latest_activity":        activity,
        "warnings":               warnings,
        "errors":                 errors,
    }

    # ── Write files ───────────────────────────────────────────────────
    store_dir = output_dir / store_code
    store_dir.mkdir(parents=True, exist_ok=True)

    _t3 = _perf_now_ms()
    json_path = store_dir / f"{date_str}.json"
    json_path.write_text(
        json.dumps(log_dict, indent=2, ensure_ascii=False, default=str),
        encoding="utf-8",
    )
    json_write_ms = _perf_ms(_t3)
    emit(f"Wrote JSON: {json_path} in {json_write_ms:.0f} ms.")

    _t4 = _perf_now_ms()
    md_path = store_dir / f"{date_str}.md"
    md_path.write_text(
        _build_markdown(log_dict),
        encoding="utf-8",
    )
    md_write_ms = _perf_ms(_t4)
    emit(f"Wrote Markdown: {md_path} in {md_write_ms:.0f} ms.")

    total_ms = _perf_ms(_t0)
    log_dict["metrics"] = {
        "qb_connect_duration_ms":         round(qb_connect_ms),
        "qb_query_duration_ms":            round(qb_query_ms),
        "json_write_duration_ms":          round(json_write_ms),
        "markdown_write_duration_ms":       round(md_write_ms),
        "activity_log_generation_duration_ms": round(total_ms),
        "warning_count":                  len(warnings),
        "error_count":                    len(errors),
    }
    # Re-write JSON with metrics
    json_path.write_text(
        json.dumps(log_dict, indent=2, ensure_ascii=False, default=str),
        encoding="utf-8",
    )

    # ── Write to activity log service ─────────────────────────────────
    _log_activity_event(store_code, date_str, status, warnings, errors)

    return log_dict


# ── Helpers ───────────────────────────────────────────────────────────────────

def _normalize_activity_entry(q: dict) -> dict:
    """Keep only the fields relevant for the log output."""
    return {
        "found":         q.get("found", False),
        "last_txn_date": q.get("last_txn_date"),
        "ref_number":    q.get("ref_number"),
        "amount":        q.get("amount"),
        "customer":      q.get("customer"),
        "class_name":    q.get("class_name"),
        "account":       q.get("account"),
        "memo":          q.get("memo"),
        "cleared":       q.get("cleared"),
        "status":        "FOUND" if q.get("found") else ("WARNING" if q.get("warning") else "NOT_FOUND"),
        "warning":       q.get("warning"),
        "error":         q.get("error"),
    }


def _collect_diag(q: dict, label: str, warnings: list, errors: list) -> None:
    if q.get("error"):
        errors.append(f"{label}: {q['error']}")
    elif q.get("warning"):
        warnings.append(f"{label}: {q['warning']}")


def _determine_status(errors: list, warnings: list) -> str:
    if errors:
        return LOG_STATUS_ERROR
    if warnings:
        return LOG_STATUS_WARNING
    return LOG_STATUS_PASS


def _load_existing_log(output_dir: Path, store_code: str, date_str: str) -> dict:
    p = _checkpoint_path(output_dir, store_code, date_str)
    try:
        return json.loads(p.read_text(encoding="utf-8-sig"))
    except Exception:
        return {"store": store_code, "date": date_str, "status": LOG_STATUS_SKIPPED}


def _log_activity_event(store_code: str, date_str: str, status: str,
                         warnings: list, errors: list) -> None:
    try:
        from services.activity_log_service import log as activity_log, EventCategory, EventSeverity
        sev = EventSeverity.ERROR if errors else (EventSeverity.WARNING if warnings else EventSeverity.INFO)
        activity_log(
            EventCategory.QB_SYNC,
            f"QB Activity Log: {store_code} / {date_str}",
            detail=f"status={status} warnings={len(warnings)} errors={len(errors)}",
            success=status == LOG_STATUS_PASS,
            severity=sev,
        )
    except Exception:
        pass


# ── Markdown builder ──────────────────────────────────────────────────────────

def _build_markdown(log: dict) -> str:
    store_name = log.get("store_name") or log.get("store", "Unknown")
    date_str   = log.get("date", "")
    status     = log.get("status", "")
    company    = log.get("quickbooks_company_file", "")
    gen_at     = log.get("generated_at", "")
    act        = log.get("latest_activity") or {}
    warnings   = log.get("warnings") or []
    errors     = log.get("errors") or []

    def _fmt_amount(v) -> str:
        if v is None:
            return "N/A"
        try:
            return f"${float(v):,.2f}"
        except (TypeError, ValueError):
            return str(v)

    def _val(v) -> str:
        return str(v) if v else "N/A"

    lines = [
        f"# QB Activity Log — {store_name} — {date_str}",
        "",
        f"**Status:** {status}  ",
        f"**Company File:** {company}  ",
        f"**Generated At:** {gen_at}  ",
        "",
    ]

    # Sales Receipt
    sr = act.get("sales_receipt") or {}
    if sr:
        lines += [
            "## Latest Sales Receipt",
            f"**Status:** {sr.get('status', 'N/A')}  ",
            f"**Last Date:** {_val(sr.get('last_txn_date'))}  ",
            f"**Ref Number:** {_val(sr.get('ref_number'))}  ",
            f"**Amount:** {_fmt_amount(sr.get('amount'))}  ",
            f"**Customer:** {_val(sr.get('customer'))}  ",
            f"**Class:** {_val(sr.get('class_name'))}  ",
            "",
        ]
        if sr.get("warning"):
            lines.append(f"> ⚠️ {sr['warning']}")
            lines.append("")

    # Invoice
    inv = act.get("invoice") or {}
    if inv:
        lines += [
            "## Latest Invoice",
            f"**Status:** {inv.get('status', 'N/A')}  ",
            f"**Last Date:** {_val(inv.get('last_txn_date'))}  ",
            f"**Ref Number:** {_val(inv.get('ref_number'))}  ",
            f"**Amount:** {_fmt_amount(inv.get('amount'))}  ",
            f"**Customer:** {_val(inv.get('customer'))}  ",
            "",
        ]

    # Payment
    pmt = act.get("payment") or {}
    if pmt:
        lines += [
            "## Latest Payment",
            f"**Status:** {pmt.get('status', 'N/A')}  ",
            f"**Last Date:** {_val(pmt.get('last_txn_date'))}  ",
            f"**Amount:** {_fmt_amount(pmt.get('amount'))}  ",
            f"**Customer:** {_val(pmt.get('customer'))}  ",
            "",
        ]

    # Deposit
    dep = act.get("deposit") or {}
    if dep:
        lines += [
            "## Latest Deposit",
            f"**Status:** {dep.get('status', 'N/A')}  ",
            f"**Last Date:** {_val(dep.get('last_txn_date'))}  ",
            f"**Amount:** {_fmt_amount(dep.get('amount'))}  ",
            f"**Account:** {_val(dep.get('account'))}  ",
            "",
        ]

    # Journal Entry
    je = act.get("journal_entry") or {}
    if je:
        lines += [
            "## Latest Journal Entry",
            f"**Status:** {je.get('status', 'N/A')}  ",
            f"**Last Date:** {_val(je.get('last_txn_date'))}  ",
            f"**Ref Number:** {_val(je.get('ref_number'))}  ",
            f"**Amount:** {_fmt_amount(je.get('amount'))}  ",
            "",
        ]

    # Bill
    bill = act.get("bill") or {}
    if bill:
        lines += [
            "## Latest Bill / Expense",
            f"**Status:** {bill.get('status', 'N/A')}  ",
            f"**Last Date:** {_val(bill.get('last_txn_date'))}  ",
            f"**Amount:** {_fmt_amount(bill.get('amount'))}  ",
            f"**Vendor:** {_val(bill.get('customer'))}  ",
            "",
        ]

    # Bank Transactions
    bts = act.get("bank_transactions") or []
    if bts:
        lines.append("## Bank Transactions")
        for bt in bts:
            acct = bt.get("account") or "Unknown Account"
            lines += [
                f"### {acct}",
                f"**Status:** {bt.get('status', 'N/A')}  ",
                f"**Last Bank Transaction Date:** {_val(bt.get('last_txn_date'))}  ",
                f"**Amount:** {_fmt_amount(bt.get('amount'))}  ",
                "",
            ]
            if bt.get("warning"):
                lines.append(f"> ⚠️ {bt['warning']}")
                lines.append("")

    # Reconcile
    recs = act.get("reconcile") or []
    if recs:
        lines.append("## Reconcile")
        for rec in recs:
            acct = rec.get("account") or "Unknown Account"
            lines += [
                f"### {acct}",
                f"**Status:** {rec.get('status', 'N/A')}  ",
                f"**Last Reconciled Date:** {_val(rec.get('last_txn_date'))}  ",
                "",
            ]
            if rec.get("warning"):
                lines.append(f"> ⚠️ {rec['warning']}")
                lines.append("")

    # Warnings
    lines.append("## Warnings")
    if warnings:
        for w in warnings:
            lines.append(f"- {w}")
    else:
        lines.append("None")
    lines.append("")

    # Errors
    if errors:
        lines.append("## Errors")
        for e in errors:
            lines.append(f"- ❌ {e}")
        lines.append("")

    # ── Performance Metrics ───────────────────────────────────────────────
    metrics = log.get("metrics") or {}
    if metrics:
        total_ms    = metrics.get("activity_log_generation_duration_ms", 0)
        qb_conn_ms  = metrics.get("qb_connect_duration_ms", 0)
        qb_qry_ms   = metrics.get("qb_query_duration_ms", 0)
        json_ms     = metrics.get("json_write_duration_ms", 0)
        md_ms       = metrics.get("markdown_write_duration_ms", 0)
        warn_cnt    = metrics.get("warning_count", 0)
        err_cnt     = metrics.get("error_count", 0)

        lines.append("## Performance Metrics")
        lines.append("")
        lines.append("| Metric | Value |")
        lines.append("|---|---:|")
        lines.append(f"| QB Connect | {qb_conn_ms} ms |")
        lines.append(f"| QB Query | {qb_qry_ms} ms |")
        lines.append(f"| JSON Write | {json_ms} ms |")
        lines.append(f"| Markdown Write | {md_ms} ms |")
        lines.append(f"| **Total** | **{total_ms} ms** |")
        lines.append(f"| Warnings | {warn_cnt} |")
        lines.append(f"| Errors | {err_cnt} |")
        lines.append("")

    return "\n".join(lines)


# ── Multi-store runner ────────────────────────────────────────────────────────

def generate_all_stores(
    cfg: dict,
    *,
    qbw_paths: dict[str, str],
    date_str: str | None = None,
    force: bool = False,
    on_log: Optional[Callable[[str], None]] = None,
) -> list[dict]:
    """
    Run generate_activity_log for all configured stores.
    Returns list of log dicts.
    """
    output_dir = Path(cfg.get("output_dir") or "logs/qb-activity")
    include_types = cfg.get("include_transaction_types")
    results = []

    for store_cfg in cfg.get("stores") or []:
        code = (store_cfg.get("code") or "").lower()
        qbw_path = qbw_paths.get(code) or qbw_paths.get(store_cfg.get("name") or "") or ""
        if not qbw_path:
            msg = f"No QB company file path for store '{code}'"
            if callable(on_log):
                on_log(f"SKIP: {msg}")
            results.append({
                "store": code,
                "date": date_str or _today_str(),
                "status": LOG_STATUS_ERROR,
                "errors": [msg],
            })
            continue

        try:
            result = generate_activity_log(
                store_cfg,
                qbw_path,
                output_dir,
                date_str=date_str,
                force=force,
                include_types=include_types,
                on_log=on_log,
            )
            results.append(result)
        except Exception as exc:
            error_msg = f"Unexpected error for store '{code}': {exc}"
            _log.exception(error_msg)
            if callable(on_log):
                on_log(f"ERROR: {error_msg}")
            results.append({
                "store": code,
                "date": date_str or _today_str(),
                "status": LOG_STATUS_ERROR,
                "errors": [error_msg],
            })

    return results
