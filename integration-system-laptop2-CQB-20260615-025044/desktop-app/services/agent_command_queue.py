"""
Agent Command Queue Service
============================
Provides a communication channel between the UI and the background agent.

Command queue: runtime/agent-commands/
Result folder:  runtime/agent-command-results/

Command file format:
{
  "id": "cmd-20260605-001",
  "type": "GENERATE_ACTIVITY_LOG_NOW",
  "created_at": "2026-06-05T09:00:00Z",
  "status": "PENDING",
  "payload": {
    "force": true
  }
}

Supported commands:
  OPEN_QB_NOW
  TEST_QB_CONNECTION
  GENERATE_ACTIVITY_LOG_NOW
  GENERATE_TIMELINE_NOW
  RUN_AUTO_SYNC_NOW
  OPEN_LOG_FOLDER
  STOP_AGENT
  RESTART_AGENT
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

_log = logging.getLogger(__name__)

# ── Supported command types ───────────────────────────────────────────────────
SUPPORTED_COMMANDS = {
    "OPEN_QB_NOW",
    "TEST_QB_CONNECTION",
    "GENERATE_ACTIVITY_LOG_NOW",
    "GENERATE_TIMELINE_NOW",
    "RUN_AUTO_SYNC_NOW",
    "OPEN_LOG_FOLDER",
    "STOP_AGENT",
    "RESTART_AGENT",
}


def _cmd_dir() -> Path:
    try:
        from app_paths import runtime_path
        return runtime_path("runtime") / "agent-commands"
    except Exception:
        return Path("runtime") / "agent-commands"


def _result_dir() -> Path:
    try:
        from app_paths import runtime_path
        return runtime_path("runtime") / "agent-command-results"
    except Exception:
        return Path("runtime") / "agent-command-results"


def _ensure_dirs() -> None:
    _cmd_dir().mkdir(parents=True, exist_ok=True)
    _result_dir().mkdir(parents=True, exist_ok=True)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _cmd_id() -> str:
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    return f"cmd-{ts}-{uuid.uuid4().hex[:4]}"


def _cmd_path(cmd_id: str) -> Path:
    return _cmd_dir() / f"{cmd_id}.json"


def _result_path(cmd_id: str) -> Path:
    return _result_dir() / f"{cmd_id}.json"


# ── Write command ─────────────────────────────────────────────────────────────

def write_command(
    command_type: str,
    payload: Optional[dict] = None,
) -> str:
    """
    Write a new command file for the background agent to process.
    Returns the command ID.
    """
    _ensure_dirs()

    if command_type not in SUPPORTED_COMMANDS:
        raise ValueError(f"Unsupported command type: {command_type}")

    cmd_id = _cmd_id()
    cmd_file = _cmd_path(cmd_id)
    cmd_data = {
        "id": cmd_id,
        "type": command_type,
        "created_at": _utc_now_iso(),
        "status": "PENDING",
        "payload": payload or {},
    }
    cmd_file.write_text(json.dumps(cmd_data, indent=2, ensure_ascii=False), encoding="utf-8")
    _log.info("Command written: %s (%s)", cmd_id, command_type)
    return cmd_id


# ── Read command ──────────────────────────────────────────────────────────────

def read_command(cmd_id: str) -> Optional[dict]:
    """Read a command file. Returns None if not found."""
    path = _cmd_path(cmd_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return None


def read_all_pending_commands() -> list[dict]:
    """Return all pending command dicts, sorted by creation time."""
    _ensure_dirs()
    pending = []
    for f in sorted(_cmd_dir().glob("*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8-sig"))
            if data.get("status") == "PENDING":
                pending.append(data)
        except Exception:
            pass
    return pending


# ── Update command status ──────────────────────────────────────────────────────

def mark_command_processing(cmd_id: str) -> None:
    """Mark a command as PROCESSING."""
    path = _cmd_path(cmd_id)
    if not path.exists():
        return
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
        data["status"] = "PROCESSING"
        data["processing_started_at"] = _utc_now_iso()
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception as exc:
        _log.warning("Failed to mark command processing: %s", exc)


def complete_command(cmd_id: str, result: dict) -> None:
    """
    Mark a command as COMPLETED and write the result.
    """
    _ensure_dirs()

    # Update command file
    cmd_path = _cmd_path(cmd_id)
    if cmd_path.exists():
        try:
            data = json.loads(cmd_path.read_text(encoding="utf-8-sig"))
            data["status"] = "COMPLETED"
            data["completed_at"] = _utc_now_iso()
            cmd_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        except Exception as exc:
            _log.warning("Failed to update command file: %s", exc)

    # Write result file
    result_path = _result_path(cmd_id)
    result_data = {
        "cmd_id": cmd_id,
        "completed_at": _utc_now_iso(),
        "result": result,
    }
    result_path.write_text(json.dumps(result_data, indent=2, ensure_ascii=False), encoding="utf-8")
    _log.info("Command completed: %s", cmd_id)


def fail_command(cmd_id: str, error: str) -> None:
    """Mark a command as FAILED."""
    _ensure_dirs()

    cmd_path = _cmd_path(cmd_id)
    if cmd_path.exists():
        try:
            data = json.loads(cmd_path.read_text(encoding="utf-8-sig"))
            data["status"] = "FAILED"
            data["failed_at"] = _utc_now_iso()
            data["error"] = error
            cmd_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        except Exception as exc:
            _log.warning("Failed to update command file: %s", exc)

    result_path = _result_path(cmd_id)
    result_data = {
        "cmd_id": cmd_id,
        "failed_at": _utc_now_iso(),
        "result": {"ok": False, "message": error},
        "error": error,
    }
    result_path.write_text(json.dumps(result_data, indent=2, ensure_ascii=False), encoding="utf-8")
    _log.info("Command failed: %s — %s", cmd_id, error)


# ── Read result ────────────────────────────────────────────────────────────────

def read_result(cmd_id: str) -> Optional[dict]:
    """Read the result of a command."""
    path = _result_path(cmd_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return None


# ── Cleanup old commands ──────────────────────────────────────────────────────

def cleanup_old_commands(max_age_days: int = 7) -> int:
    """
    Remove command and result files older than max_age_days.
    Returns the count of files removed.
    """
    _ensure_dirs()
    import time
    cutoff = time.time() - (max_age_days * 86400)
    removed = 0

    for path in list(_cmd_dir().glob("*.json")) + list(_result_dir().glob("*.json")):
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
                removed += 1
        except Exception:
            pass

    if removed:
        _log.info("Cleaned up %d old command files.", removed)
    return removed


# ── Command executor ──────────────────────────────────────────────────────────

def execute_command(
    cmd: dict,
    *,
    qb_startup_service=None,
    qb_activity_log_scheduler=None,
    qb_timeline_scheduler=None,
    auto_sync_scheduler=None,
    on_log: Optional[Callable[[str], None]] = None,
) -> dict:
    """
    Execute a single command. Returns result dict.

    Parameters
    ----------
    cmd : dict
        Command dict with 'type' and 'payload' keys.
    qb_startup_service : QBStartupService, optional
        QB startup service for OPEN_QB_NOW and TEST_QB_CONNECTION.
    qb_activity_log_scheduler : QBActivityLogScheduler, optional
        For GENERATE_ACTIVITY_LOG_NOW.
    qb_timeline_scheduler : QBActivityTimelineScheduler, optional
        For GENERATE_TIMELINE_NOW.
    auto_sync_scheduler : AutoReportSyncScheduler, optional
        For RUN_AUTO_SYNC_NOW.
    on_log : callable, optional
        Progress callback.
    """
    cmd_type = cmd.get("type", "")
    payload = dict(cmd.get("payload") or {})
    force = bool(payload.get("force", False))

    def emit(msg: str) -> None:
        if callable(on_log):
            try:
                on_log(msg)
            except Exception:
                pass

    emit(f"Executing command: {cmd_type}")

    if cmd_type == "OPEN_QB_NOW":
        if qb_startup_service is None:
            return {"ok": False, "message": "QB startup service not available"}
        status = qb_startup_service.run_now()
        return {"ok": status.status == "QB_READY", "message": status.message, "status": status.status}

    if cmd_type == "TEST_QB_CONNECTION":
        if qb_startup_service is None:
            return {"ok": False, "message": "QB startup service not available"}
        status = qb_startup_service.run_now()
        return {
            "ok": status.status in ("QB_READY", "QB_WRONG_CO", "QB_CONNECTING"),
            "message": f"QB status: {status.status} — {status.message}",
            "status": status.status,
        }

    if cmd_type == "GENERATE_ACTIVITY_LOG_NOW":
        if qb_activity_log_scheduler is None:
            return {"ok": False, "message": "QB activity log scheduler not available"}
        result = qb_activity_log_scheduler.trigger_now(force=force)
        return {"ok": True, "result": result}

    if cmd_type == "GENERATE_TIMELINE_NOW":
        if qb_timeline_scheduler is None:
            return {"ok": False, "message": "QB timeline scheduler not available"}
        result = qb_timeline_scheduler.trigger_now(force=force)
        return {"ok": True, "result": result}

    if cmd_type == "RUN_AUTO_SYNC_NOW":
        if auto_sync_scheduler is None:
            return {"ok": False, "message": "Auto sync scheduler not available"}
        status = auto_sync_scheduler.trigger_now()
        return {"ok": True, "status": status.status, "message": status.message}

    if cmd_type == "OPEN_LOG_FOLDER":
        try:
            from services.tray_service import open_log_folder
            open_log_folder()
            return {"ok": True, "message": "Log folder opened"}
        except Exception as exc:
            return {"ok": False, "message": str(exc)}

    if cmd_type == "STOP_AGENT":
        # Signal the agent to stop
        try:
            from services.app_single_instance import release_agent_lock
            release_agent_lock()
            return {"ok": True, "message": "Agent stop signal sent"}
        except Exception as exc:
            return {"ok": False, "message": str(exc)}

    if cmd_type == "RESTART_AGENT":
        return {"ok": True, "message": "Restart signal sent (agent will self-restart on next heartbeat)"}

    return {"ok": False, "message": f"Unknown command type: {cmd_type}"}
