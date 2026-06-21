"""
QB Activity Timeline Scheduler
==============================
Runs once per day per store after QB is ready.
Produces timeline JSON + MD files in logs/qb-activity/<store>/<date>-timeline.

Mirrors the QB Activity Log scheduler architecture.
"""

from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

_log = logging.getLogger(__name__)

# ── Status constants ──────────────────────────────────────────────────────────
TL_SCHED_OFF          = "Off"
TL_SCHED_WAITING      = "Waiting"
TL_SCHED_QB_NOT_READY = "QB not ready"
TL_SCHED_RUNNING      = "Running"
TL_SCHED_DONE         = "Done"
TL_SCHED_FAILED       = "Failed"


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


class QBActivityTimelineScheduler:
    """
    Polls every 60 s. When daily_time is reached, generates QB activity timelines
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
        self._raw_config = config
        self._get_qb_status = get_qb_status
        self._on_status = on_status
        self._on_log = on_log
        self._poll_interval = max(10, poll_interval_seconds)
        self._stop_event = threading.Event()
        self._lock = threading.Lock()
        self._status = TL_SCHED_OFF
        self._message = "Not started"
        self._last_run_at = ""
        self._last_error = ""
        self._triggered_date = ""
        self._has_run_once = False

    # ── Public ────────────────────────────────────────────────────────────────

    def start(self) -> None:
        t = threading.Thread(target=self._loop, daemon=True, name="qb-timeline-sched")
        t.start()

    def stop(self) -> None:
        self._stop_event.set()

    def get_status(self) -> tuple[str, str]:
        with self._lock:
            return self._status, self._message

    def trigger_now(self, *, force: bool = False) -> dict:
        """Manually trigger timeline generation. Synchronous."""
        self._emit("Manual trigger: generating QB activity timelines now...")
        return self._run_timelines(force=force)

    def get_last_run_at(self) -> str:
        with self._lock:
            return self._last_run_at

    # ── Internal ──────────────────────────────────────────────────────────────

    def _emit(self, msg: str) -> None:
        _log.info("[QBTimelineScheduler] %s", msg)
        if callable(self._on_log):
            try:
                self._on_log(msg)
            except Exception:
                pass

    def _set_status(self, status: str, message: str) -> None:
        with self._lock:
            self._status = status
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
                _log.exception("QBTimelineScheduler tick error")
                self._set_status(TL_SCHED_FAILED, f"Tick error: {exc}")
            self._stop_event.wait(timeout=self._poll_interval)

    def _tick(self) -> None:
        cfg_raw = self._raw_config or _load_local_config()

        from services.qb_activity_timeline_service import load_timeline_config
        cfg = load_timeline_config(cfg_raw)

        if not cfg["enabled"]:
            self._set_status(TL_SCHED_OFF, "QB activity timeline is disabled.")
            return

        if not cfg["stores"]:
            self._set_status(TL_SCHED_OFF, "No stores configured for QB activity timeline.")
            return

        # Time check
        tz_name = "America/Chicago"
        now_local = _local_now(tz_name)
        today_str = now_local.date().isoformat()

        daily_time = cfg["daily_time"]
        try:
            h, m = [int(x) for x in daily_time.split(":")[:2]]
        except Exception:
            h, m = 9, 15

        # run_on_app_start: if first tick, ignore time check
        run_on_start = bool(cfg.get("run_on_app_start", False))
        is_time = (now_local.hour > h) or (now_local.hour == h and now_local.minute >= m)
        if not is_time and not (run_on_start and not self._has_run_once):
            self._set_status(TL_SCHED_WAITING, f"Waiting until {daily_time} to generate QB activity timelines.")
            return

        if self._triggered_date == today_str:
            self._set_status(TL_SCHED_DONE, f"QB activity timelines already generated for {today_str}.")
            return

        # QB readiness
        if callable(self._get_qb_status):
            qb_status = self._get_qb_status()
            if qb_status != "QB_READY":
                self._set_status(TL_SCHED_QB_NOT_READY, f"Waiting for QB (current: {qb_status}).")
                return

        self._run_timelines()
        self._triggered_date = today_str
        self._has_run_once = True

    def _run_timelines(self, *, force: bool = False) -> dict:
        cfg_raw = self._raw_config or _load_local_config()

        from services.qb_activity_timeline_service import load_timeline_config, generate_all_timelines
        cfg = load_timeline_config(cfg_raw)

        qbw_paths: dict[str, str] = {}
        raw_qbw = cfg_raw.get("qbw_paths") or {}
        for store_cfg in cfg.get("stores") or []:
            code = (store_cfg.get("code") or "").lower()
            path = raw_qbw.get(code) or ""
            if not path:
                for k, v in raw_qbw.items():
                    if k.lower() == (store_cfg.get("name") or "").lower():
                        path = v
                        break
            if path:
                qbw_paths[code] = path

        self._set_status(TL_SCHED_RUNNING, "Generating QB activity timelines...")

        try:
            results = generate_all_timelines(
                cfg,
                qbw_paths=qbw_paths,
                force=force,
                on_log=self._emit,
            )
            all_ok = all(r.get("status") in ("PASS", "WARNING", "SKIPPED") for r in results)
            any_err = any(r.get("status") == "ERROR" for r in results)

            with self._lock:
                self._last_run_at = _utc_now_iso()

            if any_err:
                errors = [e for r in results for e in (r.get("errors") or [])]
                summary = f"Completed with errors: {'; '.join(errors[:3])}"
                self._set_status(TL_SCHED_FAILED, summary)
                with self._lock:
                    self._last_error = summary
            else:
                done_stores = [r.get("store", "?") for r in results]
                self._set_status(TL_SCHED_DONE, f"Timelines generated: {', '.join(done_stores)}")
                with self._lock:
                    self._last_error = ""

            return {"ok": all_ok, "results": results}

        except Exception as exc:
            _log.exception("_run_timelines error")
            msg = f"Timeline generation failed: {exc}"
            self._set_status(TL_SCHED_FAILED, msg)
            with self._lock:
                self._last_error = msg
            return {"ok": False, "error": msg}


# ── Module-level singleton ──────────────────────────────────────────────────────

_timeline_scheduler_instance: QBActivityTimelineScheduler | None = None


def get_timeline_scheduler() -> QBActivityTimelineScheduler | None:
    return _timeline_scheduler_instance


def start_timeline_scheduler(
    *,
    config: dict | None = None,
    get_qb_status: Optional[Callable[[], str]] = None,
    on_status: Optional[Callable[[str, str], None]] = None,
    on_log: Optional[Callable[[str], None]] = None,
    poll_interval_seconds: int = 60,
) -> QBActivityTimelineScheduler:
    global _timeline_scheduler_instance
    _timeline_scheduler_instance = QBActivityTimelineScheduler(
        config=config,
        get_qb_status=get_qb_status,
        on_status=on_status,
        on_log=on_log,
        poll_interval_seconds=poll_interval_seconds,
    )
    _timeline_scheduler_instance.start()
    return _timeline_scheduler_instance
