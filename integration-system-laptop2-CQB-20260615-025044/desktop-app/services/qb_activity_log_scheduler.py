"""
QB Activity Log Scheduler
=========================
Runs once per day per store after QB is ready.
Produces JSON + MD activity logs in logs/qb-activity/<store>/<date>.

Design mirrors auto_report_sync_scheduler: one daemon thread polling every
60 s, respects QB readiness state, prevents duplicate runs via file-based
checkpoint (same as generate_activity_log's duplicate guard).

Status constants
----------------
ALOG_OFF         — disabled in config
ALOG_WAITING     — waiting for daily_time
ALOG_QB_NOT_READY — QB not ready yet
ALOG_RUNNING     — generating logs now
ALOG_DONE        — today's run completed
ALOG_FAILED      — last run had errors
"""

from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

_log = logging.getLogger(__name__)

ALOG_OFF          = "Off"
ALOG_WAITING      = "Waiting"
ALOG_QB_NOT_READY = "QB not ready"
ALOG_RUNNING      = "Running"
ALOG_DONE         = "Done"
ALOG_FAILED       = "Failed"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _local_now(tz_name: str) -> datetime:
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo(tz_name))
    except Exception:
        return datetime.now()


def _load_local_config() -> dict:
    try:
        from app_paths import runtime_path
        p = runtime_path("local-config.json")
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8-sig"))
    except Exception as exc:
        _log.warning("Could not load local-config.json: %s", exc)
    return {}


class QBActivityLogScheduler:
    """
    Polls every 60 s. When daily_time is reached, generates QB activity logs
    for all configured stores. Skips if QB not ready or already done today.
    """

    def __init__(
        self,
        *,
        config: dict | None = None,
        get_qb_status: Optional[Callable[[], str]] = None,
        on_status: Optional[Callable[[str, str], None]] = None,
        on_log: Optional[Callable[[str], None]] = None,
        poll_interval_seconds: int = 60,
    ):
        self._raw_config  = config
        self._get_qb_status = get_qb_status
        self._on_status   = on_status   # callback(status: str, message: str)
        self._on_log      = on_log
        self._poll_interval = max(10, poll_interval_seconds)
        self._stop_event  = threading.Event()
        self._lock        = threading.Lock()
        self._status      = ALOG_OFF
        self._message     = "Not started"
        self._last_run_at = ""
        self._last_error  = ""
        self._triggered_date = ""   # date string for which we last triggered

    # ── Public ────────────────────────────────────────────────────────────────

    def start(self) -> None:
        t = threading.Thread(target=self._loop, daemon=True, name="qb-activity-log-sched")
        t.start()

    def stop(self) -> None:
        self._stop_event.set()

    def get_status(self) -> tuple[str, str]:
        with self._lock:
            return self._status, self._message

    def trigger_now(self, *, force: bool = False) -> dict:
        """Manually trigger log generation. Synchronous (blocks caller)."""
        self._emit("Manual trigger: generating QB activity logs now...")
        return self._run_logs(force=force)

    def get_last_run_at(self) -> str:
        with self._lock:
            return self._last_run_at

    # ── Internal ──────────────────────────────────────────────────────────────

    def _emit(self, msg: str) -> None:
        _log.info("[QBActivityLogScheduler] %s", msg)
        if callable(self._on_log):
            try:
                self._on_log(msg)
            except Exception:
                pass

    def _set_status(self, status: str, message: str) -> None:
        with self._lock:
            self._status  = status
            self._message = message
        self._emit(f"[{status}] {message}")
        if callable(self._on_status):
            try:
                self._on_status(status, message)
            except Exception as exc:
                _log.warning("on_status callback error: %s", exc)

    def _loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                self._tick()
            except Exception as exc:
                _log.exception("QBActivityLogScheduler tick error")
                self._set_status(ALOG_FAILED, f"Tick error: {exc}")
            self._stop_event.wait(timeout=self._poll_interval)

    def _tick(self) -> None:
        cfg_raw = self._raw_config or _load_local_config()

        from services.qb_activity_log_service import load_qb_activity_config
        cfg = load_qb_activity_config(cfg_raw)

        if not cfg["enabled"]:
            self._set_status(ALOG_OFF, "QB activity log is disabled.")
            return

        if not cfg["stores"]:
            self._set_status(ALOG_OFF, "No stores configured for QB activity log.")
            return

        # ── Timezone / time check ─────────────────────────────────────
        # Use first store's timezone or America/Chicago default
        tz_name = "America/Chicago"
        now_local = _local_now(tz_name)
        today_str = now_local.date().isoformat()

        daily_time = cfg["daily_time"]
        try:
            h, m = [int(x) for x in daily_time.split(":")[:2]]
        except Exception:
            h, m = 9, 15

        is_time = (now_local.hour > h) or (now_local.hour == h and now_local.minute >= m)
        if not is_time:
            self._set_status(ALOG_WAITING, f"Waiting until {daily_time} to generate QB activity logs.")
            return

        # Already triggered today?
        if self._triggered_date == today_str:
            self._set_status(ALOG_DONE, f"QB activity logs already generated for {today_str}.")
            return

        # ── QB readiness ──────────────────────────────────────────────
        if callable(self._get_qb_status):
            qb_status = self._get_qb_status()
            if qb_status != "QB_READY":
                self._set_status(ALOG_QB_NOT_READY, f"Waiting for QB (current: {qb_status}).")
                return

        # ── Run ───────────────────────────────────────────────────────
        self._run_logs()
        self._triggered_date = today_str

    def _run_logs(self, *, force: bool = False) -> dict:
        cfg_raw = self._raw_config or _load_local_config()

        from services.qb_activity_log_service import load_qb_activity_config, generate_all_stores
        cfg = load_qb_activity_config(cfg_raw)

        qbw_paths: dict[str, str] = {}
        raw_qbw = cfg_raw.get("qbw_paths") or {}
        for store_cfg in cfg.get("stores") or []:
            code = (store_cfg.get("code") or "").lower()
            # Try exact code match first, then name match in qbw_paths
            path = raw_qbw.get(code) or ""
            if not path:
                # try matching by store display name
                for k, v in raw_qbw.items():
                    if k.lower() == (store_cfg.get("name") or "").lower():
                        path = v
                        break
            if path:
                qbw_paths[code] = path

        self._set_status(ALOG_RUNNING, "Generating QB activity logs...")

        try:
            results = generate_all_stores(
                cfg,
                qbw_paths=qbw_paths,
                force=force,
                on_log=self._emit,
            )
            all_ok  = all(r.get("status") in ("PASS", "WARNING", "SKIPPED") for r in results)
            any_err = any(r.get("status") == "ERROR" for r in results)

            with self._lock:
                self._last_run_at = _utc_now_iso()

            if any_err:
                errors = [
                    e for r in results for e in (r.get("errors") or [])
                ]
                summary = f"Completed with errors: {'; '.join(errors[:3])}"
                self._set_status(ALOG_FAILED, summary)
                with self._lock:
                    self._last_error = summary
            else:
                done_stores = [r.get("store", "?") for r in results]
                self._set_status(ALOG_DONE, f"Logs generated: {', '.join(done_stores)}")
                with self._lock:
                    self._last_error = ""

            return {"ok": all_ok, "results": results}

        except Exception as exc:
            _log.exception("_run_logs error")
            msg = f"Log generation failed: {exc}"
            self._set_status(ALOG_FAILED, msg)
            with self._lock:
                self._last_error = msg
            return {"ok": False, "error": msg}


# ── Module-level singleton ────────────────────────────────────────────────────

_scheduler_instance: QBActivityLogScheduler | None = None


def get_activity_log_scheduler() -> QBActivityLogScheduler | None:
    return _scheduler_instance


def start_activity_log_scheduler(
    *,
    config: dict | None = None,
    get_qb_status: Optional[Callable[[], str]] = None,
    on_status: Optional[Callable[[str, str], None]] = None,
    on_log: Optional[Callable[[str], None]] = None,
    poll_interval_seconds: int = 60,
) -> QBActivityLogScheduler:
    global _scheduler_instance
    _scheduler_instance = QBActivityLogScheduler(
        config=config,
        get_qb_status=get_qb_status,
        on_status=on_status,
        on_log=on_log,
        poll_interval_seconds=poll_interval_seconds,
    )
    _scheduler_instance.start()
    return _scheduler_instance
