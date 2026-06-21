"""
update_scheduler.py
Checks for updates every 12 hours. Never auto-installs without approval.
Also supports manual check via check_now().
Reports UPDATE_CHECKED and UPDATE_AVAILABLE events to Mi-core.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Callable
from json_file_utils import load_json_file

logger = logging.getLogger(__name__)

CHECK_INTERVAL_HOURS = 12
STATE_FILE = Path("C:/ProgramData/ToastPOSManager/runtime/update-scheduler-state.json")


@dataclass
class UpdateSchedulerState:
    last_checked: str = ""
    last_result_version: str = ""
    update_available: bool = False
    update_version: str = ""
    error: str = ""

    def to_dict(self) -> dict:
        return {
            "last_checked": self.last_checked,
            "last_result_version": self.last_result_version,
            "update_available": self.update_available,
            "update_version": self.update_version,
            "error": self.error,
        }

    @staticmethod
    def from_dict(d: dict) -> "UpdateSchedulerState":
        s = UpdateSchedulerState()
        s.last_checked = d.get("last_checked", "")
        s.last_result_version = d.get("last_result_version", "")
        s.update_available = bool(d.get("update_available", False))
        s.update_version = d.get("update_version", "")
        s.error = d.get("error", "")
        return s


class UpdateScheduler:
    """
    Runs a background thread that checks for updates every 12 hours.
    Fires on_update_available callback when a newer version is found.
    Never auto-installs.
    """

    def __init__(
        self,
        mi_core_client=None,
        on_update_available: Optional[Callable] = None,
        check_interval_hours: float = CHECK_INTERVAL_HOURS,
    ):
        self._client = mi_core_client
        self._on_update = on_update_available
        self._interval = check_interval_hours * 3600
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._state = self._load_state()

    # ── State persistence ────────────────────────────────────────────────────

    def _load_state(self) -> UpdateSchedulerState:
        try:
            if STATE_FILE.exists():
                return UpdateSchedulerState.from_dict(
                    load_json_file(STATE_FILE)
                )
        except Exception:
            pass
        return UpdateSchedulerState()

    def _save_state(self) -> None:
        try:
            STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
            STATE_FILE.write_text(
                json.dumps(self._state.to_dict(), indent=2), encoding="utf-8"
            )
        except Exception as e:
            logger.warning("Could not save update scheduler state: %s", e)

    # ── Check logic ──────────────────────────────────────────────────────────

    def check_now(self) -> dict:
        """Perform an immediate update check. Returns UpdateCheckResult.to_dict()."""
        from services.update_client import check_for_updates
        logger.info("Checking for updates...")
        result = check_for_updates(mi_core_client=self._client)

        self._state.last_checked = result.checked_at
        self._state.last_result_version = result.latest_version or ""
        self._state.update_available = result.update_available
        self._state.update_version = result.latest_version or "" if result.update_available else ""
        self._state.error = result.error or ""
        self._save_state()

        self._report_event("UPDATE_CHECKED", result.current_version)
        if result.update_available:
            self._report_event("UPDATE_AVAILABLE", result.latest_version or "")
            if self._on_update:
                try:
                    self._on_update(result)
                except Exception as e:
                    logger.warning("on_update_available callback error: %s", e)

        return result.to_dict()

    def get_state(self) -> dict:
        return self._state.to_dict()

    # ── Scheduler thread ─────────────────────────────────────────────────────

    def _loop(self) -> None:
        # Check overdue on startup
        self.check_now()
        while not self._stop_event.wait(self._interval):
            self.check_now()

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._loop,
            name="UpdateScheduler",
            daemon=True,
        )
        self._thread.start()
        logger.info("UpdateScheduler started (interval: %dh)", CHECK_INTERVAL_HOURS)

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=5)
        logger.info("UpdateScheduler stopped")

    # ── Mi-core event ────────────────────────────────────────────────────────

    def _report_event(self, event_type: str, version: str) -> None:
        if self._client is None:
            return
        try:
            from services.machine_identity_service import get_machine_identity
            machine_id = get_machine_identity()
            self._client.post("/api/integration-agent/update-events", {
                "machine_id": machine_id,
                "event_type": event_type,
                "version": version,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
        except Exception as e:
            logger.warning("Could not report update event %s: %s", event_type, e)


# ── Module-level singleton ────────────────────────────────────────────────────

_scheduler: Optional[UpdateScheduler] = None


def get_scheduler(mi_core_client=None, on_update_available=None) -> UpdateScheduler:
    global _scheduler
    if _scheduler is None:
        _scheduler = UpdateScheduler(
            mi_core_client=mi_core_client,
            on_update_available=on_update_available,
        )
    return _scheduler


def start_update_scheduler(mi_core_client=None, on_update_available=None) -> UpdateScheduler:
    s = get_scheduler(mi_core_client=mi_core_client, on_update_available=on_update_available)
    s.start()
    return s
