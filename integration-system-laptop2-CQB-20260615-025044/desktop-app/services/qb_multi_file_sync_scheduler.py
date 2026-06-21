"""
qb_multi_file_sync_scheduler.py
=================================
Runs a 12-hour sync cycle across all enabled QuickBooks company files.
Never runs two files concurrently. Persists cycle state to runtime/qb-file-sync-state.json.
Reports each cycle and file result to Mi-core.
"""
from __future__ import annotations

import json
import logging
import random
import threading
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

from services.qb_file_registry import get_enabled_files
from services.qb_file_sync_runner import run_file_sync

logger = logging.getLogger("qb_multi_file_sync_scheduler")

try:
    from app_paths import RUNTIME_DIR
except ImportError:
    RUNTIME_DIR = Path(__file__).resolve().parent.parent

STATE_FILE = RUNTIME_DIR / "runtime" / "qb-file-sync-state.json"
STATE_FILE.parent.mkdir(parents=True, exist_ok=True)

DEFAULT_INTERVAL_HOURS = 12
DEFAULT_JITTER_MINUTES = 10

_scheduler_thread: Optional[threading.Thread] = None
_stop_event = threading.Event()
_running = False


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_state() -> dict:
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE, "r", encoding="utf-8-sig") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def _save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)


def _get_config() -> dict:
    try:
        from app_paths import RUNTIME_DIR as rd
        config_path = rd / "local-config.json"
    except ImportError:
        config_path = RUNTIME_DIR / "local-config.json"
    try:
        with open(config_path, "r", encoding="utf-8-sig") as f:
            cfg = json.load(f)
        return cfg.get("sync_schedule", {})
    except Exception:
        return {}


def _next_cycle_time(interval_hours: int = DEFAULT_INTERVAL_HOURS,
                     jitter_minutes: int = DEFAULT_JITTER_MINUTES) -> datetime:
    jitter = random.randint(0, max(0, jitter_minutes)) * 60
    return datetime.now(timezone.utc) + timedelta(hours=interval_hours, seconds=jitter)


def get_state() -> dict:
    return _load_state()


def run_cycle_now(mi_core_client=None) -> dict:
    """Run one full sync cycle across all enabled QB files. Blocking."""
    cycle_id = str(uuid.uuid4())
    started_at = _utc_now()
    logger.info("=== 12H Sync Cycle %s started ===", cycle_id)

    files = get_enabled_files()
    total = len(files)
    pass_count = warning_count = error_count = 0
    file_results: dict[str, dict] = {}

    cfg = _get_config()
    interval_hours = cfg.get("interval_hours", DEFAULT_INTERVAL_HOURS)
    jitter_minutes = cfg.get("jitter_minutes", DEFAULT_JITTER_MINUTES)
    next_cycle = _next_cycle_time(interval_hours, jitter_minutes)

    for entry in files:
        logger.info("Syncing file: %s (%s)", entry.file_id, entry.company_file_path)
        try:
            result = run_file_sync(entry, mi_core_client=mi_core_client)
        except Exception as e:
            logger.exception("Unhandled error syncing %s", entry.file_id)
            result = {
                "file_id": entry.file_id,
                "status": "ERROR",
                "message": str(e),
                "duration_ms": 0,
                "synced_at": _utc_now(),
            }

        status = result.get("status", "ERROR")
        file_results[entry.file_id] = result

        if status == "PASS":
            pass_count += 1
        elif status in ("PASS_WITH_WARNINGS", "QB_PASSWORD_REQUIRED", "SKIPPED"):
            warning_count += 1
        else:
            error_count += 1

        logger.info("  %s → %s", entry.file_id, status)

    finished_at = _utc_now()

    # Persist state
    state = _load_state()
    state["last_cycle_started_at"] = started_at
    state["last_cycle_finished_at"] = finished_at
    state["next_cycle_at"] = next_cycle.isoformat()
    if "files" not in state:
        state["files"] = {}
    for fid, r in file_results.items():
        state["files"][fid] = {
            "last_status": r.get("status", "ERROR"),
            "last_synced_at": r.get("synced_at"),
            "last_error": r.get("message", ""),
        }
    _save_state(state)

    # Report cycle to Mi-core
    if mi_core_client:
        try:
            mi_core_client.report_sync_cycle(
                cycle_id=cycle_id,
                started_at=started_at,
                finished_at=finished_at,
                total_files=total,
                pass_count=pass_count,
                warning_count=warning_count,
                error_count=error_count,
                next_cycle_at=next_cycle.isoformat(),
            )
        except Exception as e:
            logger.warning("Failed to report cycle to Mi-core: %s", e)

    logger.info("=== Cycle %s done: %d pass, %d warn, %d error ===",
                cycle_id, pass_count, warning_count, error_count)

    return {
        "cycle_id": cycle_id,
        "started_at": started_at,
        "finished_at": finished_at,
        "total_files": total,
        "pass_count": pass_count,
        "warning_count": warning_count,
        "error_count": error_count,
        "next_cycle_at": next_cycle.isoformat(),
        "file_results": file_results,
    }


def _scheduler_loop(mi_core_client=None) -> None:
    global _running
    _running = True
    logger.info("QB multi-file sync scheduler started")

    # Check if we should run immediately (overdue)
    state = _load_state()
    next_cycle_str = state.get("next_cycle_at")
    if next_cycle_str:
        try:
            next_cycle = datetime.fromisoformat(next_cycle_str)
            now = datetime.now(timezone.utc)
            if next_cycle.tzinfo is None:
                next_cycle = next_cycle.replace(tzinfo=timezone.utc)
            if now >= next_cycle:
                logger.info("Overdue cycle — running immediately")
                run_cycle_now(mi_core_client)
        except Exception:
            pass
    else:
        # First run — schedule initial cycle
        cfg = _get_config()
        interval_hours = cfg.get("interval_hours", DEFAULT_INTERVAL_HOURS)
        jitter_minutes = cfg.get("jitter_minutes", DEFAULT_JITTER_MINUTES)
        next_cycle = _next_cycle_time(interval_hours, jitter_minutes)
        state["next_cycle_at"] = next_cycle.isoformat()
        _save_state(state)
        logger.info("First cycle scheduled at %s", next_cycle.isoformat())

    while not _stop_event.is_set():
        state = _load_state()
        next_cycle_str = state.get("next_cycle_at")
        if next_cycle_str:
            try:
                next_cycle = datetime.fromisoformat(next_cycle_str)
                if next_cycle.tzinfo is None:
                    next_cycle = next_cycle.replace(tzinfo=timezone.utc)
                now = datetime.now(timezone.utc)
                wait_secs = (next_cycle - now).total_seconds()
                if wait_secs > 0:
                    # Sleep in small intervals so stop_event is checked
                    _stop_event.wait(timeout=min(wait_secs, 60))
                    continue
            except Exception as e:
                logger.warning("Next cycle time parse error: %s", e)

        if _stop_event.is_set():
            break
        run_cycle_now(mi_core_client)
        _stop_event.wait(timeout=60)  # short gap before re-reading state

    _running = False
    logger.info("QB multi-file sync scheduler stopped")


def start_scheduler(mi_core_client=None) -> None:
    global _scheduler_thread
    if _scheduler_thread and _scheduler_thread.is_alive():
        logger.info("Scheduler already running")
        return
    _stop_event.clear()
    _scheduler_thread = threading.Thread(
        target=_scheduler_loop,
        args=(mi_core_client,),
        daemon=True,
        name="qb-multi-file-sync",
    )
    _scheduler_thread.start()


def stop_scheduler() -> None:
    _stop_event.set()


def is_running() -> bool:
    return _running
