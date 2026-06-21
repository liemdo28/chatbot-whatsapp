"""
Background Agent Service
========================
Runs all background tasks: QB startup, activity log, timeline, auto-sync.
Runs in a separate process from the UI.

State machine:
  AGENT_OFF
  AGENT_STARTING
  AGENT_RUNNING
  → QB_CLOSED / QB_OPENING / QB_CONNECTING / QB_READY / QB_WRONG_CO / QB_BLOCKED / QB_DISABLED
  → LOG_WAITING / LOG_RUNNING / LOG_DONE / LOG_FAILED
  → TIMELINE_WAITING / TIMELINE_RUNNING / TIMELINE_DONE / TIMELINE_FAILED
  → AUTO_SYNC (Off / Waiting / Running / Done / Failed)

Heartbeat file: runtime/agent-heartbeat.json (updated every 60 seconds)

Command processing: runtime/agent-commands/ (poll every 10 seconds)
"""

from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

_log = logging.getLogger(__name__)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


# ── State constants ────────────────────────────────────────────────────────────
AGENT_OFF          = "AGENT_OFF"
AGENT_STARTING    = "AGENT_STARTING"
AGENT_RUNNING     = "AGENT_RUNNING"
AGENT_STOPPING    = "AGENT_STOPPING"
AGENT_STOPPED     = "AGENT_STOPPED"

LOG_WAITING       = "LOG_WAITING"
LOG_RUNNING       = "LOG_RUNNING"
LOG_DONE          = "LOG_DONE"
LOG_FAILED        = "LOG_FAILED"

TIMELINE_WAITING  = "TIMELINE_WAITING"
TIMELINE_RUNNING  = "TIMELINE_RUNNING"
TIMELINE_DONE     = "TIMELINE_DONE"
TIMELINE_FAILED   = "TIMELINE_FAILED"


def _load_local_config() -> dict:
    try:
        from app_paths import runtime_path
        p = runtime_path("local-config.json")
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8-sig"))
    except Exception as exc:
        _log.warning("Could not load local-config.json: %s", exc)
    return {}


class BackgroundAgentService:
    """
    Manages all background services for the Toast POS Manager agent.

    Runs:
    - QB startup service (auto-open QB and connect)
    - QB Activity Log scheduler
    - QB Activity Timeline scheduler
    - Auto report sync scheduler (if enabled)
    - Command queue processor

    Writes heartbeat every 60 seconds.
    """

    def __init__(
        self,
        *,
        config: Optional[dict] = None,
        on_log: Optional[Callable[[str], None]] = None,
        heartbeat_seconds: int = 60,
        command_poll_seconds: int = 10,
    ):
        self._raw_config = config
        self._on_log = on_log
        self._heartbeat_seconds = max(30, heartbeat_seconds)
        self._command_poll_seconds = max(5, command_poll_seconds)

        self._stop_event = threading.Event()
        self._lock = threading.Lock()

        self._state = AGENT_OFF
        self._started_at = ""
        self._qb_status = "Unknown"
        self._activity_log_status = "Waiting"
        self._timeline_status = "Waiting"
        self._auto_sync_status = "Off"
        self._last_error = ""

        # Service instances
        self._qb_startup_svc = None
        self._activity_log_sched = None
        self._timeline_sched = None
        self._auto_sync_sched = None

        # Agent-level services
        self._heartbeat_after_id = None
        self._command_processor_thread = None

    # ── Public ─────────────────────────────────────────────────────────────────

    def start(self) -> None:
        """Start the background agent. Non-blocking."""
        with self._lock:
            self._started_at = _utc_now_iso()
            self._state = AGENT_STARTING

        self._emit("Background agent starting...")

        # Ensure runtime dirs exist
        try:
            from app_paths import runtime_path
            runtime_path("runtime").mkdir(parents=True, exist_ok=True)
            runtime_path("logs").mkdir(parents=True, exist_ok=True)
            runtime_path("logs").joinpath("qb-activity").mkdir(parents=True, exist_ok=True)
        except Exception as exc:
            self._log_error(f"Could not create runtime directories: {exc}")

        # Start QB startup service first
        self._start_qb_startup()

        # Start activity log scheduler
        self._start_activity_log_scheduler()

        # Start timeline scheduler
        self._start_timeline_scheduler()

        # Start auto sync scheduler
        self._start_auto_sync_scheduler()

        # Start command processor
        self._start_command_processor()

        # Start heartbeat loop
        self._start_heartbeat()

        with self._lock:
            self._state = AGENT_RUNNING

        self._emit("Background agent running.")

    def stop(self) -> None:
        """Stop all background services."""
        self._state = AGENT_STOPPING
        self._stop_event.set()

        if self._activity_log_sched is not None:
            try:
                self._activity_log_sched.stop()
            except Exception:
                pass

        if self._timeline_sched is not None:
            try:
                self._timeline_sched.stop()
            except Exception:
                pass

        if self._auto_sync_sched is not None:
            try:
                self._auto_sync_sched.stop()
            except Exception:
                pass

        self._state = AGENT_STOPPED
        self._emit("Background agent stopped.")

        # Release lock
        try:
            from services.app_single_instance import release_agent_lock
            release_agent_lock()
        except Exception:
            pass

    def get_status(self) -> dict:
        """Return current agent status dict."""
        with self._lock:
            return {
                "state": self._state,
                "started_at": self._started_at,
                "last_heartbeat_at": _utc_now_iso(),
                "qb_status": self._qb_status,
                "activity_log_status": self._activity_log_status,
                "timeline_status": self._timeline_status,
                "auto_sync_status": self._auto_sync_status,
                "last_error": self._last_error,
            }

    # ── Internal ───────────────────────────────────────────────────────────────

    def _emit(self, msg: str) -> None:
        _log.info("[BackgroundAgent] %s", msg)
        if callable(self._on_log):
            try:
                self._on_log(msg)
            except Exception:
                pass

    def _log_error(self, msg: str) -> None:
        _log.error("[BackgroundAgent] %s", msg)
        with self._lock:
            self._last_error = msg
        if callable(self._on_log):
            try:
                self._on_log(f"ERROR: {msg}")
            except Exception:
                pass

    def _start_qb_startup(self) -> None:
        """Start QB startup service."""
        try:
            from services.qb_startup_service import QBStartupService

            def on_qb_status(status_obj):
                with self._lock:
                    self._qb_status = status_obj.status

            config = self._raw_config or _load_local_config()
            self._qb_startup_svc = QBStartupService(
                config=config,
                on_status=on_qb_status,
                on_log=lambda m: self._emit(f"[QB] {m}"),
            )
            self._qb_startup_svc.run_in_background()
            self._emit("QB startup service started.")
        except Exception as exc:
            self._log_error(f"QB startup service failed: {exc}")

    def _start_activity_log_scheduler(self) -> None:
        """Start QB activity log scheduler."""
        try:
            from services.qb_activity_log_scheduler import QBActivityLogScheduler

            def get_qb_status() -> str:
                if self._qb_startup_svc is None:
                    return "QB_DISABLED"
                return self._qb_startup_svc.get_status().status

            def on_alog_status(status: str, message: str):
                with self._lock:
                    if "Running" in status:
                        self._activity_log_status = LOG_WAITING
                    elif status in ("Done", "Pass"):
                        self._activity_log_status = LOG_DONE
                    elif "Failed" in status or "Error" in status:
                        self._activity_log_status = LOG_FAILED
                    else:
                        self._activity_log_status = status

            config = self._raw_config or _load_local_config()
            self._activity_log_sched = QBActivityLogScheduler(
                config=config,
                get_qb_status=get_qb_status,
                on_status=on_alog_status,
                on_log=lambda m: self._emit(f"[ActivityLog] {m}"),
            )
            self._activity_log_sched.start()
            self._emit("Activity log scheduler started.")
        except Exception as exc:
            self._log_error(f"Activity log scheduler failed: {exc}")

    def _start_timeline_scheduler(self) -> None:
        """Start QB activity timeline scheduler."""
        try:
            from services.qb_activity_timeline_scheduler import QBActivityTimelineScheduler

            def get_qb_status() -> str:
                if self._qb_startup_svc is None:
                    return "QB_DISABLED"
                return self._qb_startup_svc.get_status().status

            def on_tl_status(status: str, message: str):
                with self._lock:
                    if "Running" in status:
                        self._timeline_status = TIMELINE_RUNNING
                    elif status in ("Done", "Pass"):
                        self._timeline_status = TIMELINE_DONE
                    elif "Failed" in status or "Error" in status:
                        self._timeline_status = TIMELINE_FAILED
                    else:
                        self._timeline_status = status

            config = self._raw_config or _load_local_config()
            self._timeline_sched = QBActivityTimelineScheduler(
                config=config,
                get_qb_status=get_qb_status,
                on_status=on_tl_status,
                on_log=lambda m: self._emit(f"[Timeline] {m}"),
            )
            self._timeline_sched.start()
            self._emit("Timeline scheduler started.")
        except Exception as exc:
            self._log_error(f"Timeline scheduler failed: {exc}")

    def _start_auto_sync_scheduler(self) -> None:
        """Start auto report sync scheduler (only if enabled)."""
        try:
            from services.auto_report_sync_scheduler import AutoReportSyncScheduler

            def get_qb_status() -> str:
                if self._qb_startup_svc is None:
                    return "QB_DISABLED"
                return self._qb_startup_svc.get_status().status

            def on_sync_status(status_obj):
                with self._lock:
                    self._auto_sync_status = status_obj.status

            config = self._raw_config or _load_local_config()
            auto_sync_cfg = config.get("auto_sync") or {}
            if not auto_sync_cfg.get("enabled", False):
                with self._lock:
                    self._auto_sync_status = "Off"
                self._emit("Auto sync is disabled in config — skipping.")
                return

            self._auto_sync_sched = AutoReportSyncScheduler(
                config=config,
                get_qb_status=get_qb_status,
                on_status=on_sync_status,
                on_log=lambda m: self._emit(f"[AutoSync] {m}"),
            )
            self._auto_sync_sched.start()
            with self._lock:
                self._auto_sync_status = "Waiting"
            self._emit("Auto sync scheduler started.")
        except Exception as exc:
            self._log_error(f"Auto sync scheduler failed: {exc}")

    def _start_command_processor(self) -> None:
        """Start the command queue processor thread."""
        self._command_processor_thread = threading.Thread(
            target=self._command_processor_loop,
            daemon=True,
            name="command-processor",
        )
        self._command_processor_thread.start()
        self._emit("Command processor started.")

    def _command_processor_loop(self) -> None:
        """Poll for pending commands and execute them."""
        while not self._stop_event.is_set():
            try:
                self._process_pending_commands()
            except Exception as exc:
                _log.warning("Command processor error: %s", exc)
            self._stop_event.wait(timeout=self._command_poll_seconds)

    def _process_pending_commands(self) -> None:
        """Process all pending commands."""
        try:
            from services.agent_command_queue import (
                read_all_pending_commands,
                mark_command_processing,
                complete_command,
                fail_command,
                execute_command,
            )

            pending = read_all_pending_commands()
            for cmd in pending:
                cmd_id = cmd.get("id")
                if not cmd_id:
                    continue

                try:
                    mark_command_processing(cmd_id)

                    result = execute_command(
                        cmd,
                        qb_startup_service=self._qb_startup_svc,
                        qb_activity_log_scheduler=self._activity_log_sched,
                        qb_timeline_scheduler=self._timeline_sched,
                        auto_sync_scheduler=self._auto_sync_sched,
                        on_log=lambda m: self._emit(f"[CMD] {m}"),
                    )

                    if result.get("ok", False):
                        complete_command(cmd_id, result)
                    else:
                        fail_command(cmd_id, result.get("message", "Command failed"))
                except Exception as exc:
                    _log.error("Command %s failed: %s", cmd_id, exc)
                    if cmd_id:
                        fail_command(cmd_id, str(exc))
        except ImportError as exc:
            _log.warning("Command queue service not available: %s", exc)

    def _start_heartbeat(self) -> None:
        """Start the heartbeat thread that writes status every N seconds."""
        t = threading.Thread(target=self._heartbeat_loop, daemon=True, name="heartbeat")
        t.start()

    def _heartbeat_loop(self) -> None:
        """Write heartbeat file every N seconds."""
        while not self._stop_event.is_set():
            try:
                self._write_heartbeat()
            except Exception as exc:
                _log.warning("Heartbeat write error: %s", exc)
            self._stop_event.wait(timeout=self._heartbeat_seconds)

    def _write_heartbeat(self) -> None:
        """Write the heartbeat file and scheduler state file."""
        try:
            from services.app_single_instance import write_heartbeat as _write_hb

            with self._lock:
                status = self._state
                started_at = self._started_at
                qb_status = self._qb_status
                activity_log_status = self._activity_log_status
                timeline_status = self._timeline_status
                auto_sync_status = self._auto_sync_status
                last_error = self._last_error

            _write_hb(
                status=status,
                started_at=started_at,
                qb_status=qb_status,
                activity_log_status=activity_log_status,
                timeline_status=timeline_status,
                auto_sync_status=auto_sync_status,
                last_error=last_error,
            )

            # Also write scheduler state
            self._write_scheduler_state()

        except Exception as exc:
            _log.warning("Failed to write heartbeat: %s", exc)

    def _write_scheduler_state(self) -> None:
        """Write runtime/scheduler-state.json with current scheduler statuses."""
        try:
            from services.reporting_outbox import get_outbox

            outbox = get_outbox()

            # Gather scheduler status
            activity_last_run = ""
            activity_last_status = ""
            timeline_last_run = ""
            timeline_last_status = ""
            sync_last_run = ""
            sync_last_status = ""

            if self._activity_log_sched is not None:
                activity_last_run, activity_msg = self._activity_log_sched.get_status()
                activity_last_status = activity_msg

            if self._timeline_sched is not None:
                timeline_last_run, timeline_msg = self._timeline_sched.get_status()
                timeline_last_status = timeline_msg

            if self._auto_sync_sched is not None:
                sync_status_obj = self._auto_sync_sched.get_status()
                sync_last_run = sync_status_obj.last_sync_at
                sync_last_status = sync_status_obj.status

            state = {
                "updated_at": _utc_now_iso(),
                "agent_status": self._state,
                "qb_status": self._qb_status,
                "activity_log": {
                    "last_run": activity_last_run,
                    "last_status": activity_last_status,
                    "scheduled_time": "09:15",
                },
                "timeline": {
                    "last_run": timeline_last_run,
                    "last_status": timeline_last_status,
                    "scheduled_time": "09:20",
                },
                "reporting_sync": {
                    "last_run": sync_last_run,
                    "last_status": sync_last_status,
                    "outbox_pending": outbox.count(),
                },
            }

            path = _get_scheduler_state_path()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
        except Exception as exc:
            _log.debug("_write_scheduler_state failed: %s", exc)


# ── Scheduler state file ──────────────────────────────────────────────────────

def _get_scheduler_state_path() -> Path:
    try:
        from app_paths import runtime_path
        return runtime_path("runtime") / "scheduler-state.json"
    except Exception:
        return Path("runtime") / "scheduler-state.json"


def write_scheduler_state(state: dict) -> None:
    """
    Write runtime/scheduler-state.json with current scheduler statuses.
    Called after each heartbeat tick.
    """
    try:
        path = _get_scheduler_state_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        import json as _json
        path.write_text(_json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
        _log.debug("[SchedulerState] written: %s", path)
    except Exception as exc:
        _log.warning("[SchedulerState] write failed: %s", exc)


def read_scheduler_state() -> dict:
    """Read runtime/scheduler-state.json. Returns empty dict on error."""
    try:
        path = _get_scheduler_state_path()
        if path.exists():
            import json as _json
            return _json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        pass
    return {}



def run_background_agent(
    config: Optional[dict] = None,
    heartbeat_seconds: int = 60,
    command_poll_seconds: int = 10,
) -> BackgroundAgentService:
    """
    Create and start the background agent service.
    Returns the service instance so callers can stop it.
    """
    service = BackgroundAgentService(
        config=config,
        heartbeat_seconds=heartbeat_seconds,
        command_poll_seconds=command_poll_seconds,
    )
    service.start()
    return service
