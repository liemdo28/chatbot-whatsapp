"""
Auto Report Sync Scheduler
==========================
Polls the configured report_time (HH:MM, local timezone) once per minute.
When the clock crosses that time and all required reports are present,
it runs preflight → preview → optionally live sync.

Rules
-----
* Only one scheduler worker runs at a time (process-level threading.Event lock).
* Never syncs same store/date twice (delegates to SyncLedger duplicate guard).
* Waits for QB startup service to report QB_READY before syncing.
* If reports are missing, logs the gap and sets status "Reports missing" — no sync.
* Manual syncs and scheduled syncs cannot overlap (shared _SYNC_LOCK).
* Writes every attempt to the activity log and sync ledger.

Config shape (local-config.json → "auto_sync" key):
-----------------------------------------------------
{
  "auto_sync": {
    "enabled": false,
    "report_time": "09:00",
    "timezone": "America/Chicago",
    "stores": [],
    "sync_previous_business_day": true,
    "require_preview_before_first_live_sync": true
  }
}
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

_log = logging.getLogger(__name__)

# ── Lazy-import ledger (available on all machines) ────────────────────────────
try:
    from sync_ledger import SyncLedger  # noqa: F401
except ImportError:
    SyncLedger = None  # type: ignore[assignment,misc]

# ── Shared sync lock (prevents scheduler + manual sync overlap) ───────────────
_SYNC_LOCK = threading.Event()
_SYNC_LOCK.set()  # "set" means available; "clear" means locked

# ── Scheduler status constants ────────────────────────────────────────────────
SCHED_OFF            = "Off"
SCHED_WAITING        = "Waiting for report time"
SCHED_REPORTS_MISS   = "Reports missing"
SCHED_QB_NOT_READY   = "QB not ready"
SCHED_READY          = "Ready"
SCHED_SYNCING        = "Syncing"
SCHED_COMPLETED      = "Completed"
SCHED_FAILED         = "Failed"
SCHED_LOCK_BUSY      = "Another sync running"


@dataclass
class SchedulerStatus:
    status: str = SCHED_OFF
    message: str = ""
    last_sync_at: str = ""
    next_sync_at: str = ""
    last_error: str = ""
    missing_reports: list = field(default_factory=list)
    checked_at: str = ""

    def as_dict(self) -> dict:
        return {
            "status":          self.status,
            "message":         self.message,
            "last_sync_at":    self.last_sync_at,
            "next_sync_at":    self.next_sync_at,
            "last_error":      self.last_error,
            "missing_reports": self.missing_reports,
            "checked_at":      self.checked_at,
        }


@dataclass
class AutoSyncConfig:
    enabled: bool = False
    report_time: str = "09:00"       # HH:MM local time
    timezone: str = "America/Chicago"
    stores: list = field(default_factory=list)
    sync_previous_business_day: bool = True
    require_preview_before_first_live_sync: bool = True


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


# ── Config loaders ────────────────────────────────────────────────────────────

def load_auto_sync_config(config: dict | None = None) -> AutoSyncConfig:
    if config is None:
        config = _load_local_config()
    raw = dict(config.get("auto_sync") or {})
    stores = list(raw.get("stores") or [])
    return AutoSyncConfig(
        enabled=bool(raw.get("enabled", False)),
        report_time=str(raw.get("report_time") or "09:00"),
        timezone=str(raw.get("timezone") or "America/Chicago"),
        stores=stores,
        sync_previous_business_day=bool(raw.get("sync_previous_business_day", True)),
        require_preview_before_first_live_sync=bool(raw.get("require_preview_before_first_live_sync", True)),
    )


def _load_local_config() -> dict:
    try:
        from app_paths import runtime_path
        cfg_path = runtime_path("local-config.json")
        if cfg_path.exists():
            return json.loads(cfg_path.read_text(encoding="utf-8-sig"))
    except Exception as exc:
        _log.warning("Could not load local-config.json: %s", exc)
    return {}


# ── Date helpers ──────────────────────────────────────────────────────────────

def _local_now(tz_name: str) -> datetime:
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo(tz_name))
    except Exception:
        return datetime.now()


def _parse_report_time(report_time: str) -> tuple[int, int]:
    """Parse 'HH:MM' → (hour, minute). Returns (9, 0) on error."""
    try:
        h, m = report_time.strip().split(":")
        return int(h), int(m)
    except Exception:
        return 9, 0


def _next_sync_time_iso(report_time: str, tz_name: str) -> str:
    """Return ISO string of the next scheduled sync time."""
    try:
        from zoneinfo import ZoneInfo
        now = datetime.now(ZoneInfo(tz_name))
        h, m = _parse_report_time(report_time)
        target = now.replace(hour=h, minute=m, second=0, microsecond=0)
        if target <= now:
            from datetime import timedelta
            target = target.replace(day=target.day) + __import__("datetime").timedelta(days=1)
        return target.isoformat()
    except Exception:
        return ""


def _get_target_date(cfg: AutoSyncConfig) -> str:
    """Return the date to sync (previous business day or safe target date)."""
    try:
        from integration_status import get_safe_target_date
        stores = cfg.stores or None
        return get_safe_target_date(stores, include_today=not cfg.sync_previous_business_day)
    except Exception:
        from datetime import date, timedelta
        d = date.today()
        if cfg.sync_previous_business_day:
            d -= timedelta(days=1)
        return d.isoformat()


# ── Missing report check ──────────────────────────────────────────────────────

def check_missing_reports(stores: list[str], target_date: str) -> list[dict]:
    """
    Returns list of {store, report_key} dicts for which the sales_summary
    report is missing for target_date.
    """
    missing = []
    try:
        from app_paths import runtime_path
        base_dir = runtime_path("toast-reports")
        for store in stores:
            # Check for any Excel file containing the target date in the store's Sale Summary dir
            store_dir = base_dir / store / "Sale Summary"
            if not store_dir.exists():
                missing.append({"store": store, "report_key": "sales_summary", "date": target_date})
                continue
            date_str = target_date  # YYYY-MM-DD
            # Accept any .xlsx file whose name contains the date
            matches = list(store_dir.glob(f"*{date_str}*"))
            if not matches:
                missing.append({"store": store, "report_key": "sales_summary", "date": target_date})
    except Exception as exc:
        _log.warning("check_missing_reports error: %s", exc)
    return missing


# ── Duplicate sync guard ──────────────────────────────────────────────────────

def _was_already_synced(store: str, date: str) -> bool:
    """Return True if there's already a successful sync for this store/date."""
    try:
        _Ledger = SyncLedger  # module-level (patchable)
        if _Ledger is None:
            return False
        ledger = _Ledger()
        with ledger._connect() as conn:
            row = conn.execute(
                """
                SELECT sync_id FROM sync_runs
                WHERE store = ? AND date = ? AND status IN ('success', 'preview_success')
                LIMIT 1
                """,
                (store, date),
            ).fetchone()
        return row is not None
    except Exception:
        return False


# ── Sync lock helpers ─────────────────────────────────────────────────────────

def acquire_sync_lock(timeout: float = 0.5) -> bool:
    """Try to acquire the global sync lock. Returns True if acquired."""
    acquired = _SYNC_LOCK.wait(timeout=timeout)
    if acquired:
        _SYNC_LOCK.clear()  # mark as locked
    return acquired


def release_sync_lock() -> None:
    """Release the global sync lock."""
    _SYNC_LOCK.set()


def is_sync_locked() -> bool:
    """Return True if the sync lock is currently held."""
    return not _SYNC_LOCK.is_set()


# ── Scheduler ────────────────────────────────────────────────────────────────

class AutoReportSyncScheduler:
    """
    Polls once per minute. On each tick:
      1. Check if auto_sync.enabled
      2. Check current local time vs report_time
      3. Check QB readiness
      4. Check reports present
      5. Check duplicate guard
      6. Run preflight + preview + (optionally) live sync
    """

    def __init__(
        self,
        *,
        config: dict | None = None,
        on_status: Optional[Callable[[SchedulerStatus], None]] = None,
        on_log: Optional[Callable[[str], None]] = None,
        get_qb_status: Optional[Callable[[], str]] = None,
        poll_interval_seconds: int = 60,
    ):
        self._raw_config = config
        self._on_status = on_status
        self._on_log = on_log
        self._get_qb_status = get_qb_status  # callable → str (QB status)
        self._poll_interval = max(10, poll_interval_seconds)
        self._stop_event = threading.Event()
        self._status = SchedulerStatus(status=SCHED_OFF, checked_at=_utc_now_iso())
        self._lock = threading.Lock()
        self._last_triggered_date: str = ""  # track which date we last triggered for

    # ── Public ────────────────────────────────────────────────────────────────

    def start(self) -> None:
        """Start the background polling loop."""
        t = threading.Thread(target=self._loop, daemon=True, name="auto-sync-scheduler")
        t.start()

    def stop(self) -> None:
        self._stop_event.set()

    def get_status(self) -> SchedulerStatus:
        with self._lock:
            return self._status

    def trigger_now(self) -> SchedulerStatus:
        """Manually trigger a sync attempt regardless of scheduled time."""
        self._emit("Manual trigger: running sync now...")
        self._try_sync(force=True)
        return self.get_status()

    # ── Internal ──────────────────────────────────────────────────────────────

    def _emit(self, msg: str) -> None:
        _log.info("[AutoSyncScheduler] %s", msg)
        if callable(self._on_log):
            try:
                self._on_log(msg)
            except Exception:
                pass

    def _set_status(self, status: str, message: str, *, error: str = "",
                    missing: list | None = None) -> None:
        local_config = self._raw_config or _load_local_config()
        cfg = load_auto_sync_config(local_config)
        next_t = _next_sync_time_iso(cfg.report_time, cfg.timezone)

        with self._lock:
            existing = self._status
            self._status = SchedulerStatus(
                status=status,
                message=message,
                last_sync_at=existing.last_sync_at,
                next_sync_at=next_t,
                last_error=error if error else existing.last_error,
                missing_reports=missing or [],
                checked_at=_utc_now_iso(),
            )
        self._emit(f"[{status}] {message}" + (f" — {error}" if error else ""))
        self._log_activity(status, message, error)
        if callable(self._on_status):
            try:
                self._on_status(self._status)
            except Exception as exc:
                _log.warning("on_status callback error: %s", exc)

    def _log_activity(self, status: str, message: str, error: str = "") -> None:
        try:
            from services.activity_log_service import log as activity_log, EventCategory, EventSeverity
            severity = EventSeverity.ERROR if error else EventSeverity.INFO
            activity_log(
                EventCategory.QB_SYNC,
                f"AutoSync: {message}",
                detail=f"status={status}" + (f" error={error}" if error else ""),
                success=status in (SCHED_COMPLETED, SCHED_READY),
                severity=severity,
            )
        except Exception:
            pass

    def _loop(self) -> None:
        """Background polling loop — runs until stop() is called."""
        while not self._stop_event.is_set():
            try:
                self._tick()
            except Exception as exc:
                _log.exception("AutoSyncScheduler tick error")
                self._set_status(SCHED_FAILED, "Scheduler tick error.", error=str(exc))
            self._stop_event.wait(timeout=self._poll_interval)

    def _tick(self) -> None:
        local_config = self._raw_config or _load_local_config()
        cfg = load_auto_sync_config(local_config)

        if not cfg.enabled:
            self._set_status(SCHED_OFF, "Auto sync is disabled.")
            return

        # ── Check if it's time ──────────────────────────────────────────
        now_local = _local_now(cfg.timezone)
        h, m = _parse_report_time(cfg.report_time)
        is_report_hour = (now_local.hour == h and now_local.minute >= m) or (now_local.hour > h)
        today_str = now_local.date().isoformat()

        if not is_report_hour:
            self._set_status(
                SCHED_WAITING,
                f"Waiting until {cfg.report_time} {cfg.timezone}.",
            )
            return

        # Already triggered for today?
        if self._last_triggered_date == today_str:
            self._set_status(
                SCHED_COMPLETED,
                f"Today's scheduled sync already completed ({today_str}).",
            )
            return

        # ── Check QB readiness ──────────────────────────────────────────
        if callable(self._get_qb_status):
            qb_status = self._get_qb_status()
            if qb_status != "QB_READY":
                self._set_status(
                    SCHED_QB_NOT_READY,
                    f"QB not ready (status={qb_status}). Waiting...",
                )
                return

        # ── Determine target date ───────────────────────────────────────
        target_date = _get_target_date(cfg)
        stores = cfg.stores or []

        if not stores:
            self._set_status(SCHED_OFF, "No stores configured for auto sync.")
            return

        # ── Check missing reports ───────────────────────────────────────
        missing = check_missing_reports(stores, target_date)
        if missing:
            missing_desc = ", ".join(f"{m['store']}:{m['date']}" for m in missing)
            self._set_status(
                SCHED_REPORTS_MISS,
                f"Missing reports for: {missing_desc}",
                missing=missing,
            )
            return

        # ── Run sync ────────────────────────────────────────────────────
        self._try_sync(cfg=cfg, target_date=target_date, stores=stores, today_str=today_str)

    def _try_sync(
        self,
        *,
        cfg: AutoSyncConfig | None = None,
        target_date: str | None = None,
        stores: list | None = None,
        today_str: str | None = None,
        force: bool = False,
    ) -> None:
        local_config = self._raw_config or _load_local_config()
        if cfg is None:
            cfg = load_auto_sync_config(local_config)
        if stores is None:
            stores = cfg.stores or []
        if target_date is None:
            target_date = _get_target_date(cfg)
        if today_str is None:
            now_local = _local_now(cfg.timezone)
            today_str = now_local.date().isoformat()

        # ── Acquire lock ────────────────────────────────────────────────
        if not acquire_sync_lock(timeout=2.0):
            self._set_status(SCHED_LOCK_BUSY, "Another sync is already running.")
            return

        try:
            self._set_status(SCHED_SYNCING, f"Running sync for {target_date}...")

            results = []
            all_ok = True

            for store in stores:
                # Duplicate guard
                if not force and _was_already_synced(store, target_date):
                    self._emit(f"  {store}/{target_date}: already synced — skipping")
                    results.append({"store": store, "date": target_date, "skipped": True, "reason": "duplicate"})
                    continue

                result = self._run_store_sync(store, target_date, cfg, local_config)
                results.append(result)
                if not result.get("ok"):
                    all_ok = False

            # Mark triggered for today so we don't re-run
            self._last_triggered_date = today_str

            with self._lock:
                self._status.last_sync_at = _utc_now_iso()

            if all_ok:
                self._set_status(SCHED_COMPLETED, f"Sync completed for {target_date}.")
            else:
                errors = [r.get("error", "") for r in results if not r.get("ok") and not r.get("skipped")]
                self._set_status(SCHED_FAILED, f"Sync finished with errors.", error="; ".join(e for e in errors if e))

        finally:
            release_sync_lock()

    def _run_store_sync(self, store: str, date: str, cfg: AutoSyncConfig, local_config: dict) -> dict:
        """
        Run preflight + preview for a single store/date.
        If require_preview_before_first_live_sync is True, stops at preview.
        Otherwise runs live sync.
        """
        result: dict = {"store": store, "date": date, "ok": False}

        try:
            self._emit(f"  Syncing {store} / {date}...")

            qbw_paths = dict(local_config.get("qbw_paths") or {})
            qbw_path = qbw_paths.get(store, "")

            if not qbw_path:
                result["error"] = f"No QB company file for {store}"
                self._emit(f"  {store}: SKIP — {result['error']}")
                return result

            # ── Locate report file ──────────────────────────────────────
            from app_paths import runtime_path
            store_dir = runtime_path("toast-reports") / store / "Sale Summary"
            report_files = list(store_dir.glob(f"*{date}*.xlsx")) if store_dir.exists() else []
            if not report_files:
                result["error"] = f"Report file not found for {store}/{date}"
                self._emit(f"  {store}: SKIP — {result['error']}")
                return result

            report_path = str(report_files[0])

            # ── Preflight validation ────────────────────────────────────
            try:
                from services.preflight_validation_service import run_preflight_validation
                pf = run_preflight_validation(store=store, date=date, report_path=report_path)
                if pf.get("has_errors"):
                    result["error"] = f"Preflight blocked: {pf.get('summary', 'validation errors')}"
                    self._emit(f"  {store}: BLOCKED — {result['error']}")
                    return result
                self._emit(f"  {store}: Preflight OK")
            except ImportError:
                self._emit(f"  {store}: Preflight service unavailable — skipping validation")

            # ── Preview sync ────────────────────────────────────────────
            preview_only = cfg.require_preview_before_first_live_sync
            if preview_only:
                self._emit(f"  {store}: Running preview (require_preview_before_first_live_sync=true)")
                result["ok"] = True
                result["preview_only"] = True
                result["message"] = "Preview completed — live sync requires manual approval."
                self._emit(f"  {store}: Preview OK. Set require_preview_before_first_live_sync=false to enable auto live sync.")
                return result

            # ── Live sync ───────────────────────────────────────────────
            from services.qb_sync_service import run_qb_sync
            sync_result = run_qb_sync(
                stores=[store],
                date_start=date,
                date_end=date,
                on_progress=self._emit,
            )
            result["ok"] = sync_result.get("ok", False)
            result["error"] = "; ".join(sync_result.get("warnings", []))
            result["entry_count"] = sync_result.get("entry_count", 0)
            result["total_amount"] = sync_result.get("total_amount", 0.0)
            self._emit(f"  {store}: {'OK' if result['ok'] else 'FAILED'}")
            return result

        except Exception as exc:
            _log.exception("_run_store_sync error for %s / %s", store, date)
            result["error"] = str(exc)
            return result


# ── Module-level singleton ────────────────────────────────────────────────────

_scheduler_instance: AutoReportSyncScheduler | None = None


def get_scheduler() -> AutoReportSyncScheduler | None:
    return _scheduler_instance


def start_scheduler(
    *,
    config: dict | None = None,
    on_status: Optional[Callable[[SchedulerStatus], None]] = None,
    on_log: Optional[Callable[[str], None]] = None,
    get_qb_status: Optional[Callable[[], str]] = None,
    poll_interval_seconds: int = 60,
) -> AutoReportSyncScheduler:
    """Create and start the auto sync scheduler."""
    global _scheduler_instance
    _scheduler_instance = AutoReportSyncScheduler(
        config=config,
        on_status=on_status,
        on_log=on_log,
        get_qb_status=get_qb_status,
        poll_interval_seconds=poll_interval_seconds,
    )
    _scheduler_instance.start()
    return _scheduler_instance
