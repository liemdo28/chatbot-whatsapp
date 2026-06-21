"""
QB Activity Timeline Service
==============================
Connects to QB, queries ALL transactions for a target date per store,
normalizes into a chronological event list, and writes timeline files.

Output structure:
    <output_dir>/<store_code>/<YYYY-MM-DD>-timeline.json
    <output_dir>/<store_code>/<YYYY-MM-DD>-timeline.md

Never modifies QB data. Uses QBClient (QBXML COM) in read-only mode.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone, date as date_type
from pathlib import Path
from typing import Callable, Optional

_log = logging.getLogger(__name__)

# ── Lazy top-level imports (patchable in tests) ───────────────────────────────
try:
    from qb_client import QBClient  # noqa: F401
except ImportError:
    QBClient = None  # type: ignore[assignment,misc]

try:
    from services import qb_activity_timeline_queries as _tl_queries  # noqa: F401
except ImportError:
    _tl_queries = None  # type: ignore[assignment]

# ── Status constants ──────────────────────────────────────────────────────────
TL_STATUS_PASS    = "PASS"
TL_STATUS_WARNING = "WARNING"
TL_STATUS_ERROR   = "ERROR"
TL_STATUS_SKIPPED = "SKIPPED"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _local_now_iso() -> str:
    return datetime.now().replace(microsecond=0).isoformat()


def _today_str() -> str:
    return date_type.today().isoformat()


def _perf_now_ms() -> float:
    """Return current time in milliseconds for performance tracking."""
    return datetime.now(timezone.utc).timestamp() * 1000


def _perf_ms(start_ms: float) -> float:
    """Return elapsed milliseconds since start_ms."""
    return _perf_now_ms() - start_ms


# ── Config loader ─────────────────────────────────────────────────────────────

def load_timeline_config(config: dict | None = None) -> dict:
    """
    Extract qb_activity_timeline (or qb_activity_log fallback) from local-config dict.
    """
    if config is None:
        config = _load_local_config()
    raw = dict(config.get("qb_activity_timeline") or config.get("qb_activity_log") or {})
    return {
        "enabled":          bool(raw.get("enabled", True)),
        "run_on_app_start": bool(raw.get("run_on_app_start", False)),
        "daily_time":       str(raw.get("daily_time") or "09:15"),
        "output_dir":       str(raw.get("output_dir") or "logs/qb-activity"),
        "stores":           list(raw.get("stores") or []),
        "include_transaction_types": list(
            raw.get("include_transaction_types") or [
                "sales_receipt", "invoice", "payment", "deposit",
                "journal_entry", "bill", "check",
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


# ── Checkpoint (prevents duplicate runs) ──────────────────────────────────────

def _timeline_path(output_dir: Path, store_code: str, date_str: str) -> Path:
    return output_dir / store_code / f"{date_str}-timeline.json"


def timeline_already_generated(output_dir: Path, store_code: str, date_str: str) -> bool:
    """Return True if a timeline already exists for this store/date."""
    return _timeline_path(output_dir, store_code, date_str).exists()


# ── Event sorting ─────────────────────────────────────────────────────────────

def _sort_key(event: dict) -> str:
    """
    Sort events by best available timestamp:
    1. TimeModified (most recent action)
    2. TimeCreated
    3. TxnDate (date only, no time — sorted last)
    """
    tm = event.get("time_modified") or ""
    tc = event.get("time_created") or ""
    td = event.get("txn_date") or ""
    # Prefer time_modified > time_created > txn_date
    return tm or tc or td


def _extract_time_display(event: dict) -> str:
    """Extract HH:MM from best available timestamp."""
    for field in ("time_modified", "time_created"):
        val = event.get(field)
        if val and "T" in val:
            time_part = val.split("T")[1][:5]
            return time_part
    return "—"


# ── Event deduplication ───────────────────────────────────────────────────────

def _dedupe_events(events: list[dict]) -> list[dict]:
    """Remove duplicate events by txn_id."""
    seen: set = set()
    deduped: list[dict] = []
    for ev in events:
        txn_id = ev.get("txn_id")
        if txn_id and txn_id in seen:
            continue
        if txn_id:
            seen.add(txn_id)
        deduped.append(ev)
    return deduped


# ── Core timeline generation ──────────────────────────────────────────────────

def generate_timeline(
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
    Connect to QB company file, query ALL transactions for target date,
    build chronological timeline, write JSON + MD files.

    Parameters
    ----------
    store_cfg : dict
        Store config: {code, name, class_name, customer_name, bank_accounts}
    qbw_path : str
        Path to the .qbw company file.
    output_dir : Path | str
        Root output directory.
    date_str : str, optional
        "YYYY-MM-DD" — defaults to today.
    force : bool
        Overwrite existing timeline if True.
    include_types : list[str], optional
        Transaction types to query.
    on_log : callable, optional
        Progress callback.

    Returns
    -------
    dict : The timeline dict (same as written to JSON).
    """
    output_dir = Path(output_dir)
    date_str = date_str or _today_str()
    store_code = (store_cfg.get("code") or "unknown").lower()
    store_name = store_cfg.get("name") or store_code
    bank_accounts: list[str] = list(store_cfg.get("bank_accounts") or [])
    include_types = include_types or [
        "sales_receipt", "invoice", "payment", "deposit",
        "journal_entry", "bill", "check",
    ]
    _t0 = _perf_now_ms()

    def emit(msg: str) -> None:
        _log.info("[QBTimeline][%s] %s", store_code, msg)
        if callable(on_log):
            try:
                on_log(msg)
            except Exception:
                pass

    # ── Duplicate guard ───────────────────────────────────────────────
    if not force and timeline_already_generated(output_dir, store_code, date_str):
        emit(f"Timeline already exists for {store_code}/{date_str} — skipping (use force=True).")
        return _load_existing_timeline(output_dir, store_code, date_str)

    # ── Connect to QB ─────────────────────────────────────────────────
    emit(f"Connecting to QB for timeline: {Path(qbw_path).name}")
    events: list[dict] = []
    warnings: list[str] = []
    errors: list[str] = []
    client = None
    qb_connect_ms = 0
    qb_query_ms = 0

    try:
        _ClientCls = QBClient
        if _ClientCls is None:
            raise ImportError("qb_client not available on this machine")
        _t_conn = _perf_now_ms()
        client = _ClientCls(app_name="Toast POS Manager - Activity Timeline")
        client.connect(qbw_path)
        qb_connect_ms = _perf_ms(_t_conn)
        emit(f"QB connected in {qb_connect_ms:.0f} ms.")

        Q = _tl_queries
        if Q is None:
            raise ImportError("qb_activity_timeline_queries not available")

        _t_qry = _perf_now_ms()
        emit(f"Querying all transactions for {date_str}...")
        events, warnings, errors = Q.query_all_for_date(
            client, date_str,
            bank_accounts=bank_accounts,
            include_types=include_types,
        )
        qb_query_ms = _perf_ms(_t_qry)
        emit(f"Found {len(events)} events in {qb_query_ms:.0f} ms.")

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

    # ── Deduplicate and sort ──────────────────────────────────────────
    events = _dedupe_events(events)
    events.sort(key=_sort_key)

    # ── Build timeline event list ─────────────────────────────────────
    timeline_events = []
    for ev in events:
        timeline_events.append({
            "time": _extract_time_display(ev),
            "type": ev.get("txn_type", "unknown"),
            "action": "created_or_found",
            "ref_number": ev.get("ref_number"),
            "txn_date": ev.get("txn_date"),
            "amount": ev.get("amount"),
            "customer": ev.get("customer") or ev.get("account") or "",
            "class": ev.get("class_name") or "",
            "account": ev.get("account") or "",
            "source": "QuickBooks",
            "txn_id": ev.get("txn_id"),
            "time_created": ev.get("time_created"),
            "time_modified": ev.get("time_modified"),
        })

    # ── Add timestamp warning if none have real times ─────────────────
    has_real_time = any(
        ev.get("time_created") or ev.get("time_modified") for ev in events
    )
    if events and not has_real_time:
        warnings.append(
            "QB did not expose TimeCreated/TimeModified for any transaction. "
            "Event times shown as '—'. Timeline ordering is by TxnDate only."
        )

    # ── Build output dict ─────────────────────────────────────────────
    status = _determine_status(errors, warnings)
    timeline_dict = {
        "store": store_code,
        "store_name": store_name,
        "date": date_str,
        "quickbooks_company_file": Path(qbw_path).name,
        "quickbooks_company_path": str(qbw_path),
        "generated_at": _local_now_iso(),
        "generated_at_utc": _utc_now_iso(),
        "status": status,
        "event_count": len(timeline_events),
        "events": timeline_events,
        "warnings": warnings,
        "errors": errors,
    }

    # ── Write files ───────────────────────────────────────────────────
    _t_write = _perf_now_ms()
    store_dir = output_dir / store_code
    store_dir.mkdir(parents=True, exist_ok=True)

    json_path = store_dir / f"{date_str}-timeline.json"
    json_path.write_text(
        json.dumps(timeline_dict, indent=2, ensure_ascii=False, default=str),
        encoding="utf-8",
    )
    json_write_ms = _perf_ms(_t_write)
    emit(f"Wrote timeline JSON: {json_path} in {json_write_ms:.0f} ms.")

    _t_md = _perf_now_ms()
    md_path = store_dir / f"{date_str}-timeline.md"
    md_path.write_text(
        _build_timeline_markdown(timeline_dict),
        encoding="utf-8",
    )
    md_write_ms = _perf_ms(_t_md)
    emit(f"Wrote timeline Markdown: {md_path} in {md_write_ms:.0f} ms.")

    total_ms = _perf_ms(_t0)
    timeline_dict["metrics"] = {
        "qb_connect_duration_ms":         round(qb_connect_ms),
        "qb_query_duration_ms":          round(qb_query_ms),
        "json_write_duration_ms":         round(json_write_ms),
        "markdown_write_duration_ms":      round(md_write_ms),
        "timeline_generation_duration_ms": round(total_ms),
        "event_count":                   len(timeline_events),
        "warning_count":                 len(warnings),
        "error_count":                   len(errors),
    }
    # Re-write JSON with metrics
    json_path.write_text(
        json.dumps(timeline_dict, indent=2, ensure_ascii=False, default=str),
        encoding="utf-8",
    )

    # ── Activity log event ────────────────────────────────────────────
    _log_timeline_event(store_code, date_str, status, len(timeline_events), warnings, errors)

    return timeline_dict


# ── Helpers ───────────────────────────────────────────────────────────────────

def _determine_status(errors: list, warnings: list) -> str:
    if errors:
        return TL_STATUS_ERROR
    if warnings:
        return TL_STATUS_WARNING
    return TL_STATUS_PASS


def _load_existing_timeline(output_dir: Path, store_code: str, date_str: str) -> dict:
    p = _timeline_path(output_dir, store_code, date_str)
    try:
        return json.loads(p.read_text(encoding="utf-8-sig"))
    except Exception:
        return {"store": store_code, "date": date_str, "status": TL_STATUS_SKIPPED, "events": []}


def _log_timeline_event(store_code: str, date_str: str, status: str,
                         event_count: int, warnings: list, errors: list) -> None:
    try:
        from services.activity_log_service import log as activity_log, EventCategory, EventSeverity
        sev = EventSeverity.ERROR if errors else (EventSeverity.WARNING if warnings else EventSeverity.INFO)
        activity_log(
            EventCategory.QB_SYNC,
            f"QB Activity Timeline: {store_code} / {date_str}",
            detail=f"status={status} events={event_count} warnings={len(warnings)} errors={len(errors)}",
            success=status == TL_STATUS_PASS,
            severity=sev,
        )
    except Exception:
        pass


# ── Markdown builder ──────────────────────────────────────────────────────────

def _build_timeline_markdown(tl: dict) -> str:
    store_name = tl.get("store_name") or tl.get("store", "Unknown")
    date_str = tl.get("date", "")
    status = tl.get("status", "")
    company = tl.get("quickbooks_company_file", "")
    gen_at = tl.get("generated_at", "")
    events = tl.get("events") or []
    warnings = tl.get("warnings") or []
    errors = tl.get("errors") or []

    def _fmt_amount(v) -> str:
        if v is None:
            return "—"
        try:
            return f"${float(v):,.2f}"
        except (TypeError, ValueError):
            return str(v)

    lines = [
        f"# QB Activity Timeline — {store_name} — {date_str}",
        "",
        f"**Status:** {status}  ",
        f"**Company File:** {company}  ",
        f"**Generated At:** {gen_at}  ",
        f"**Total Events:** {len(events)}  ",
        "",
    ]

    # ── Events table ──────────────────────────────────────────────────
    lines.append("## Events")
    lines.append("")
    if events:
        lines.append("| Time | Type | Ref | Amount | Account/Customer | Status |")
        lines.append("|------|------|-----|-------:|------------------|--------|")
        for ev in events:
            time_str = ev.get("time") or "—"
            txn_type = ev.get("type", "—")
            ref = ev.get("ref_number") or "—"
            amount = _fmt_amount(ev.get("amount"))
            target = ev.get("customer") or ev.get("account") or "—"
            status_str = "Found"
            lines.append(f"| {time_str} | {txn_type} | {ref} | {amount} | {target} | {status_str} |")
        lines.append("")
    else:
        lines.append("No events found for this date.")
        lines.append("")

    # ── Warnings ──────────────────────────────────────────────────────
    lines.append("## Warnings")
    if warnings:
        for w in warnings:
            lines.append(f"- {w}")
    else:
        lines.append("None")
    lines.append("")

    # ── Errors ────────────────────────────────────────────────────────
    if errors:
        lines.append("## Errors")
        for e in errors:
            lines.append(f"- ❌ {e}")
        lines.append("")

    # ── Performance Metrics ─────────────────────────────────────────────
    metrics = tl.get("metrics") or {}
    if metrics:
        total_ms   = metrics.get("timeline_generation_duration_ms", 0)
        qb_conn_ms = metrics.get("qb_connect_duration_ms", 0)
        qb_qry_ms  = metrics.get("qb_query_duration_ms", 0)
        json_ms    = metrics.get("json_write_duration_ms", 0)
        md_ms      = metrics.get("markdown_write_duration_ms", 0)
        warn_cnt   = metrics.get("warning_count", 0)
        err_cnt    = metrics.get("error_count", 0)

        lines.append("## Performance Metrics")
        lines.append("")
        lines.append("| Metric | Value |")
        lines.append("|---|---:|")
        lines.append(f"| QB Connect | {qb_conn_ms} ms |")
        lines.append(f"| QB Query | {qb_qry_ms} ms |")
        lines.append(f"| JSON Write | {json_ms} ms |")
        lines.append(f"| Markdown Write | {md_ms} ms |")
        lines.append(f"| **Total** | **{total_ms} ms** |")
        lines.append(f"| Events | {len(events)} |")
        lines.append(f"| Warnings | {warn_cnt} |")
        lines.append(f"| Errors | {err_cnt} |")
        lines.append("")

    return "\n".join(lines)


# ── Multi-store runner ────────────────────────────────────────────────────────

def generate_all_timelines(
    cfg: dict,
    *,
    qbw_paths: dict[str, str],
    date_str: str | None = None,
    force: bool = False,
    on_log: Optional[Callable[[str], None]] = None,
) -> list[dict]:
    """
    Run generate_timeline for all configured stores.
    Returns list of timeline dicts.
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
                "status": TL_STATUS_ERROR,
                "event_count": 0,
                "events": [],
                "errors": [msg],
            })
            continue

        try:
            result = generate_timeline(
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
                "status": TL_STATUS_ERROR,
                "event_count": 0,
                "events": [],
                "errors": [error_msg],
            })

    return results
