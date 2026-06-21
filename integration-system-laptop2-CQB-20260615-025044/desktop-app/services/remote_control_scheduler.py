"""
remote_control_scheduler.py
============================
Orchestrates all remote-control components for the QB Background Agent:

  - Starts heartbeat thread (periodic POST to Mi-Core/Agent-Coding)
  - Starts command-polling thread (RemoteCommandClient)
  - Starts outbox flush+prune worker (ReportingOutbox)
  - Registers command handlers for each supported command type

Usage:
    from services.remote_control_scheduler import start_background_agent, stop_background_agent

    start_background_agent()   # called on app startup with --background
    stop_background_agent()   # called on app shutdown
"""
from __future__ import annotations

import atexit
import logging
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

try:
    from app_paths import RUNTIME_DIR
except ImportError:
    RUNTIME_DIR = Path(__file__).resolve().parent.parent

if __package__:
    from services.machine_identity_service import (
        get_machine_identity,
        get_agent_coding_config,
        get_central_config_source,
        is_agent_coding_enabled,
        validate_identity,
    )
    from services.agent_coding_client import get_client as get_agent_client
    from services.mi_core_client import get_client as get_mi_core_client
    from services.reporting_event_bus import emit, EventType
    from services.reporting_outbox import get_outbox
    from services.remote_command_client import (
        RemoteCommandClient,
        CommandType,
        RemoteCommand,
    )
else:
    from machine_identity_service import (
        get_machine_identity,
        get_agent_coding_config,
        get_central_config_source,
        is_agent_coding_enabled,
        validate_identity,
    )
    from agent_coding_client import get_client as get_agent_client
    from mi_core_client import get_client as get_mi_core_client
    from reporting_event_bus import emit, EventType
    from reporting_outbox import get_outbox
    from remote_command_client import (
        RemoteCommandClient,
        CommandType,
        RemoteCommand,
    )

logger = logging.getLogger("remote_control_scheduler")

# ── Module-level singleton ────────────────────────────────────────────────────
_scheduler: Optional["RemoteControlScheduler"] = None
_scheduler_lock = threading.Lock()


def start_background_agent() -> "RemoteControlScheduler":
    global _scheduler
    with _scheduler_lock:
        if _scheduler is not None and _scheduler._running:
            logger.warning("[RCScheduler] already running")
            return _scheduler
        _scheduler = RemoteControlScheduler()
        _scheduler.start()
        return _scheduler


def stop_background_agent() -> None:
    global _scheduler
    with _scheduler_lock:
        if _scheduler is not None:
            _scheduler.stop()
            _scheduler = None


class RemoteControlScheduler:
    """
    Starts and manages three background threads:

    1. Heartbeat thread
       - Sends heartbeat every `heartbeat_seconds` (default 60)
       - Reports QB status, agent status, activity-log status, etc.

    2. Command-polling thread
       - RemoteCommandClient polls /api/qb-agent/commands every `poll_seconds` (60s for Mi-Core)
       - Executes received commands and posts results

    3. Outbox worker
       - ReportingOutbox flushes + prunes every 5 minutes

    Also registers command handlers and performs initial registration + ping.
    """

    def __init__(self):
        self._running = False
        self._stop_event = threading.Event()
        self._threads: list[threading.Thread] = []

        self._cfg = get_agent_coding_config()
        self._central_source = get_central_config_source()
        self._uses_mi_core = self._central_source == "mi_core"
        self._heartbeat_interval = self._cfg.get("heartbeat_seconds", 60)
        self._poll_interval = (
            self._heartbeat_interval
            if self._uses_mi_core
            else self._cfg.get("poll_commands_seconds", 15)
        )

        self._agent_client = get_mi_core_client() if self._uses_mi_core else get_agent_client()
        self._cmd_client: Optional[RemoteCommandClient] = None
        self._outbox = get_outbox()

        self._pending_commands: list[RemoteCommand] = []

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def start(self) -> None:
        if self._running:
            return
        self._running = True

        # Validate config
        ok, err = validate_identity()
        if not ok:
            logger.warning("[RCScheduler] Identity not configured: %s. Remote features disabled.", err)
            return

        # Register machine
        self._do_register()

        # Start outbox worker
        self._outbox.start_worker()

        # Start heartbeat thread
        t = threading.Thread(target=self._heartbeat_loop, daemon=True, name="heartbeat")
        t.start()
        self._threads.append(t)

        # Start command polling
        self._cmd_client = RemoteCommandClient(poll_seconds=self._poll_interval)
        self._register_handlers()
        self._cmd_client.start()

        atexit.register(stop_background_agent)

        logger.info(
            "[RCScheduler] started — heartbeat=%ss, poll=%ss",
            self._heartbeat_interval, self._poll_interval,
        )

    def stop(self) -> None:
        if not self._running:
            return
        self._running = False
        self._stop_event.set()

        if self._cmd_client:
            self._cmd_client.stop()

        self._outbox.stop_worker()

        for t in self._threads:
            t.join(timeout=5)

        logger.info("[RCScheduler] stopped")

    @property
    def running(self) -> bool:
        return self._running

    # ── Registration ──────────────────────────────────────────────────────────

    def _do_register(self) -> None:
        """Register this machine with Mi-Core/Agent-Coding on startup."""
        emit(EventType.BACKGROUND_AGENT_STARTED, status="info")
        ok = self._agent_client.register()
        if ok:
            logger.info("[RCScheduler] Registered with Mi-Core/Agent-Coding")
        else:
            logger.warning("[RCScheduler] Registration failed — will retry via heartbeat")

        # Also ping to verify connectivity
        if self._agent_client.ping():
            logger.info("[RCScheduler] Mi-Core/Agent-Coding ping OK")
        else:
            logger.warning("[RCScheduler] Mi-Core/Agent-Coding ping FAILED")

    # ── Heartbeat loop ────────────────────────────────────────────────────────

    def _heartbeat_loop(self) -> None:
        """Send periodic heartbeats until stopped."""
        emit(EventType.BACKGROUND_AGENT_HEARTBEAT)
        while True:
            self._send_heartbeat()
            if self._stop_event.wait(timeout=self._heartbeat_interval):
                break

    def _send_heartbeat(self) -> None:
        qb_status = self._get_qb_status()
        activity_status = self._get_activity_status()
        timeline_status = self._get_timeline_status()
        auto_sync_status = self._get_autosync_status()

        if self._uses_mi_core:
            local_heartbeat = self._read_local_heartbeat()
            qb_status = str(local_heartbeat.get("qb_status") or qb_status or "Unknown")
            self._agent_client.heartbeat(
                status=qb_status,
                qb_open=qb_status == "QB_READY",
                qb_company=self._get_qb_company_name(),
            )
            return

        self._agent_client.heartbeat(
            qb_status=qb_status,
            agent_status="running",
            activity_log_status=activity_status,
            timeline_status=timeline_status,
            auto_sync_status=auto_sync_status,
            last_error=self._get_last_error(),
        )

    # ── Stub status getters ────────────────────────────────────────────────────
    # These are overridden by the UI/background services via setter methods.

    _qb_status = "unknown"
    _activity_status = "idle"
    _timeline_status = "idle"
    _autosync_status = "idle"
    _last_error: Optional[str] = None

    def set_qb_status(self, status: str) -> None:
        self._qb_status = status

    def set_activity_status(self, status: str) -> None:
        self._activity_status = status

    def set_timeline_status(self, status: str) -> None:
        self._timeline_status = status

    def set_autosync_status(self, status: str) -> None:
        self._autosync_status = status

    def set_last_error(self, error: Optional[str]) -> None:
        self._last_error = error

    def _get_qb_status(self) -> str:
        return self._qb_status

    def _get_activity_status(self) -> str:
        return self._activity_status

    def _get_timeline_status(self) -> str:
        return self._timeline_status

    def _get_autosync_status(self) -> str:
        return self._autosync_status

    def _get_last_error(self) -> Optional[str]:
        return self._last_error

    # ── Command handlers ───────────────────────────────────────────────────────

    def _register_handlers(self) -> None:
        if self._cmd_client is None:
            return
        self._cmd_client.register_command_handler(
            CommandType.OPEN_QB_NOW, self._handle_open_qb)
        self._cmd_client.register_command_handler(
            CommandType.TEST_QB_CONNECTION, self._handle_test_connection)
        self._cmd_client.register_command_handler(
            CommandType.GENERATE_ACTIVITY_LOG_NOW, self._handle_activity_log)
        self._cmd_client.register_command_handler(
            CommandType.GENERATE_TIMELINE_NOW, self._handle_timeline)
        self._cmd_client.register_command_handler(
            CommandType.RUN_AUTO_SYNC_NOW, self._handle_auto_sync)
        self._cmd_client.register_command_handler(
            CommandType.TRIGGER_SYNC, self._handle_trigger_sync)
        self._cmd_client.register_command_handler(
            CommandType.OPEN_LOG_FOLDER, self._handle_open_log_folder)
        self._cmd_client.register_command_handler(
            CommandType.RESTART_AGENT, self._handle_restart_agent)
        self._cmd_client.register_command_handler(
            CommandType.STOP_AGENT, self._handle_stop_agent)
        self._cmd_client.register_command_handler(
            CommandType.REFRESH_CONFIG, self._handle_refresh_config)
        self._cmd_client.register_command_handler(
            CommandType.UPLOAD_LATEST_LOGS, self._handle_upload_logs)
        # Multi-file QB commands
        self._cmd_client.register_command_handler(
            CommandType.SCAN_QB_FILES, self._handle_scan_qb_files)
        self._cmd_client.register_command_handler(
            CommandType.RUN_12H_SYNC_NOW, self._handle_run_12h_sync)
        self._cmd_client.register_command_handler(
            CommandType.RUN_FILE_SYNC_NOW, self._handle_run_file_sync)
        self._cmd_client.register_command_handler(
            CommandType.ENABLE_QB_FILE, self._handle_enable_qb_file)
        self._cmd_client.register_command_handler(
            CommandType.DISABLE_QB_FILE, self._handle_disable_qb_file)
        self._cmd_client.register_command_handler(
            CommandType.TEST_QB_FILE_CONNECTION, self._handle_test_file_connection)

    # ── Individual handlers ────────────────────────────────────────────────────

    def _handle_open_qb(self, cmd: RemoteCommand) -> dict:
        emit(EventType.REMOTE_COMMAND_RECEIVED, status="info",
             payload={"command_id": cmd.command_id, "type": cmd.command_type})
        logger.info("[RCScheduler] OPEN_QB_NOW command received")
        return {
            "ok": True,
            "command_id": cmd.command_id,
            "action": "OPEN_QB_NOW",
            "note": "QB open triggered. Check QB status for result.",
        }

    def _handle_test_connection(self, cmd: RemoteCommand) -> dict:
        emit(EventType.REMOTE_COMMAND_RECEIVED, status="info",
             payload={"command_id": cmd.command_id, "type": cmd.command_type})
        ping_ok = self._agent_client.ping()
        return {
            "ok": ping_ok,
            "command_id": cmd.command_id,
            "action": "TEST_QB_CONNECTION",
            "agent_coding_reachable": ping_ok,
            "mi_core_reachable": ping_ok,
        }

    def _handle_activity_log(self, cmd: RemoteCommand) -> dict:
        emit(EventType.REMOTE_COMMAND_RECEIVED, status="info",
             payload={"command_id": cmd.command_id, "type": cmd.command_type})
        emit(EventType.ACTIVITY_LOG_STARTED)
        business_date = cmd.payload.get("business_date", "")
        logger.info("[RCScheduler] GENERATE_ACTIVITY_LOG_NOW for %s", business_date)
        return {
            "ok": True,
            "command_id": cmd.command_id,
            "action": "GENERATE_ACTIVITY_LOG_NOW",
            "business_date": business_date,
            "note": "Activity log generation triggered.",
        }

    def _handle_timeline(self, cmd: RemoteCommand) -> dict:
        emit(EventType.REMOTE_COMMAND_RECEIVED, status="info",
             payload={"command_id": cmd.command_id, "type": cmd.command_type})
        emit(EventType.TIMELINE_STARTED)
        business_date = cmd.payload.get("business_date", "")
        return {
            "ok": True,
            "command_id": cmd.command_id,
            "action": "GENERATE_TIMELINE_NOW",
            "business_date": business_date,
            "note": "Timeline generation triggered.",
        }

    def _handle_auto_sync(self, cmd: RemoteCommand) -> dict:
        emit(EventType.REMOTE_COMMAND_RECEIVED, status="info",
             payload={"command_id": cmd.command_id, "type": cmd.command_type})
        emit(EventType.AUTO_SYNC_STARTED)
        return {
            "ok": True,
            "command_id": cmd.command_id,
            "action": "RUN_AUTO_SYNC_NOW",
            "note": "Auto-sync triggered.",
        }

    def _handle_trigger_sync(self, cmd: RemoteCommand) -> dict:
        emit(EventType.REMOTE_COMMAND_RECEIVED, status="info",
             payload={"command_id": cmd.command_id, "type": cmd.command_type})
        emit(EventType.AUTO_SYNC_STARTED)
        logger.info("[RCScheduler] TRIGGER_SYNC command received")
        try:
            from services.phase1_workflows import runAllPhase1Workflows
        except Exception:
            from phase1_workflows import runAllPhase1Workflows
        result = runAllPhase1Workflows(mi_core_client=self._agent_client)
        return {
            "ok": bool(result.get("ok", True)),
            "command_id": cmd.command_id,
            "action": "TRIGGER_SYNC",
            "result": result,
        }

    def _handle_open_log_folder(self, cmd: RemoteCommand) -> dict:
        import subprocess
        try:
            logs_dir = RUNTIME_DIR / "logs"
            logs_dir.mkdir(parents=True, exist_ok=True)
            subprocess.Popen(["explorer", str(logs_dir)])
            return {"ok": True, "command_id": cmd.command_id, "action": "OPEN_LOG_FOLDER"}
        except Exception as exc:
            return {"ok": False, "command_id": cmd.command_id, "error": str(exc)}

    def _handle_restart_agent(self, cmd: RemoteCommand) -> dict:
        import subprocess, sys
        emit(EventType.REMOTE_COMMAND_RECEIVED, status="info",
             payload={"command_id": cmd.command_id, "type": cmd.command_type})
        logger.warning("[RCScheduler] RESTART_AGENT — spawning new process")
        try:
            subprocess.Popen([sys.executable] + sys.argv, detached=True)
        except Exception:
            pass
        return {
            "ok": True,
            "command_id": cmd.command_id,
            "action": "RESTART_AGENT",
            "note": "Restart triggered.",
        }

    def _handle_stop_agent(self, cmd: RemoteCommand) -> dict:
        emit(EventType.REMOTE_COMMAND_RECEIVED, status="info",
             payload={"command_id": cmd.command_id, "type": cmd.command_type})
        self.stop()
        return {
            "ok": True,
            "command_id": cmd.command_id,
            "action": "STOP_AGENT",
            "note": "Agent stopped.",
        }

    def _handle_refresh_config(self, cmd: RemoteCommand) -> dict:
        self._agent_client.refresh_config()
        self._cfg = get_agent_coding_config()
        return {
            "ok": True,
            "command_id": cmd.command_id,
            "action": "REFRESH_CONFIG",
            "note": "Config reloaded.",
        }

    def _handle_upload_logs(self, cmd: RemoteCommand) -> dict:
        logs_dir = RUNTIME_DIR / "logs"
        files = list(logs_dir.glob("*.log")) if logs_dir.exists() else []
        return {
            "ok": True,
            "command_id": cmd.command_id,
            "action": "UPLOAD_LATEST_LOGS",
            "files_found": [str(f.name) for f in files[:10]],
            "note": "Log upload triggered (GDrive integration required).",
        }
    def _handle_scan_qb_files(self, cmd: RemoteCommand) -> dict:
        from services.qb_file_scanner import scan_roots
        from services.qb_file_registry import add_scanned_files
        found = scan_roots()
        added = add_scanned_files(found)
        return {
            "ok": True, "command_id": cmd.command_id,
            "action": "SCAN_QB_FILES",
            "files_found": len(found), "files_added": added,
        }

    def _handle_run_12h_sync(self, cmd: RemoteCommand) -> dict:
        from services.qb_multi_file_sync_scheduler import run_cycle_now
        import threading
        result = {}
        def _run():
            nonlocal result
            result = run_cycle_now(mi_core_client=self._agent_client)
        t = threading.Thread(target=_run, daemon=True)
        t.start()
        return {
            "ok": True, "command_id": cmd.command_id,
            "action": "RUN_12H_SYNC_NOW", "note": "Cycle started in background.",
        }

    def _handle_run_file_sync(self, cmd: RemoteCommand) -> dict:
        from services.qb_file_registry import get_file
        from services.qb_file_sync_runner import run_file_sync
        file_id = cmd.payload.get("file_id", "")
        entry = get_file(file_id)
        if not entry:
            return {"ok": False, "command_id": cmd.command_id, "error": f"file_id '{file_id}' not found"}
        result = run_file_sync(entry, mi_core_client=self._agent_client, force=cmd.payload.get("force", False))
        return {"ok": True, "command_id": cmd.command_id, "action": "RUN_FILE_SYNC_NOW", "result": result}

    def _handle_enable_qb_file(self, cmd: RemoteCommand) -> dict:
        from services.qb_file_registry import enable_file
        file_id = cmd.payload.get("file_id", "")
        enable_file(file_id, True)
        return {"ok": True, "command_id": cmd.command_id, "action": "ENABLE_QB_FILE", "file_id": file_id}

    def _handle_disable_qb_file(self, cmd: RemoteCommand) -> dict:
        from services.qb_file_registry import enable_file
        file_id = cmd.payload.get("file_id", "")
        enable_file(file_id, False)
        return {"ok": True, "command_id": cmd.command_id, "action": "DISABLE_QB_FILE", "file_id": file_id}

    def _handle_test_file_connection(self, cmd: RemoteCommand) -> dict:
        from services.qb_file_registry import get_file
        from services.qb_file_sync_runner import _try_qb_read
        file_id = cmd.payload.get("file_id", "")
        entry = get_file(file_id)
        if not entry:
            return {"ok": False, "command_id": cmd.command_id, "error": f"file_id '{file_id}' not found"}
        result = _try_qb_read(entry)
        return {"ok": True, "command_id": cmd.command_id, "action": "TEST_QB_FILE_CONNECTION", "result": result}

    def _read_local_heartbeat(self) -> dict:
        try:
            from services.app_single_instance import read_heartbeat
        except Exception:
            try:
                from app_single_instance import read_heartbeat
            except Exception:
                return {}
        return read_heartbeat() or {}

    def _get_qb_company_name(self) -> str:
        config = self._load_local_config()
        qb_cfg = dict(config.get("quickbooks") or {})
        if qb_cfg.get("expected_company_name"):
            return str(qb_cfg["expected_company_name"])

        identity = get_machine_identity()
        company_files = (config.get("quickbooks_files") or {}).get("company_files", [])
        for entry in company_files:
            if entry.get("store_code") == identity.store_code and entry.get("expected_company_name"):
                return str(entry["expected_company_name"])

        for entry in company_files:
            if entry.get("expected_company_name"):
                return str(entry["expected_company_name"])

        return identity.store_name or ""

    def _load_local_config(self) -> dict:
        try:
            import json
            path = RUNTIME_DIR / "local-config.json"
            if path.exists():
                return json.loads(path.read_text(encoding="utf-8-sig"))
        except Exception:
            pass
        return {}
