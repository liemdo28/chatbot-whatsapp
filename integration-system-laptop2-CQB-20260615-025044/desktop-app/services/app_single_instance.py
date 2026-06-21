"""
App Single Instance Service
===========================
Ensures only one background agent runs at a time using a lock file.

Lock file: runtime/background-agent.lock
Format:
{
  "pid": 12345,
  "started_at": "2026-06-05T09:00:00Z",
  "mode": "background"
}

Rules:
- If lock PID is still alive → do not start second agent
- If stale PID → remove lock and allow new agent
- UI can always start (reads status from heartbeat)
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Optional

_log = logging.getLogger(__name__)


def _pid_is_alive(pid: int) -> bool:
    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes

            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            open_process = kernel32.OpenProcess
            open_process.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
            open_process.restype = wintypes.HANDLE
            get_exit_code = kernel32.GetExitCodeProcess
            get_exit_code.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
            get_exit_code.restype = wintypes.BOOL
            close_handle = kernel32.CloseHandle
            close_handle.argtypes = [wintypes.HANDLE]
            close_handle.restype = wintypes.BOOL

            process_query_limited_information = 0x1000
            still_active = 259
            handle = open_process(process_query_limited_information, False, int(pid))
            if not handle:
                return False
            try:
                exit_code = wintypes.DWORD()
                if not get_exit_code(handle, ctypes.byref(exit_code)):
                    return False
                return exit_code.value == still_active
            finally:
                close_handle(handle)
        except Exception:
            return False

    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _lock_file_path() -> Path:
    try:
        from app_paths import runtime_path
        return runtime_path("runtime") / "background-agent.lock"
    except Exception:
        return Path("runtime") / "background-agent.lock"


def _heartbeat_path() -> Path:
    try:
        from app_paths import runtime_path
        return runtime_path("runtime") / "agent-heartbeat.json"
    except Exception:
        return Path("runtime") / "agent-heartbeat.json"


def _ensure_runtime_dir() -> None:
    lock = _lock_file_path()
    lock.parent.mkdir(parents=True, exist_ok=True)


def is_agent_running() -> bool:
    """Return True if the background agent lock is held by a live process."""
    lock_path = _lock_file_path()
    if not lock_path.exists():
        return False

    try:
        data = json.loads(lock_path.read_text(encoding="utf-8-sig"))
        pid = data.get("pid")
        if not pid:
            return False

        if _pid_is_alive(int(pid)):
            return True

        # Check if PID is still alive
        try:
            os.kill(pid, 0)  # signal 0 = check existence
            return True
        except OSError:
            # Process is dead — stale lock
            _log.info("Stale agent lock found (PID %s is dead). Cleaning up.", pid)
            try:
                lock_path.unlink(missing_ok=True)
            except Exception:
                pass
            return False
    except Exception as exc:
        _log.warning("Error reading agent lock: %s", exc)
        return False


def acquire_agent_lock(mode: str = "background") -> bool:
    """
    Try to acquire the agent lock.
    Returns True if acquired (this is the sole agent).
    Returns False if another agent is already running.
    """
    _ensure_runtime_dir()
    lock_path = _lock_file_path()

    if is_agent_running():
        _log.info("Another agent is already running — refusing to acquire lock.")
        return False

    now_iso = _utc_now_iso()
    lock_data = {
        "pid": os.getpid(),
        "started_at": now_iso,
        "mode": mode,
    }
    try:
        lock_path.write_text(json.dumps(lock_data, indent=2), encoding="utf-8")
        _log.info("Agent lock acquired: PID=%s mode=%s", os.getpid(), mode)
        return True
    except Exception as exc:
        _log.error("Failed to write agent lock: %s", exc)
        return False


def release_agent_lock() -> None:
    """Remove the agent lock file. Call on clean shutdown."""
    lock_path = _lock_file_path()
    try:
        if lock_path.exists():
            # Only remove if it's our lock
            try:
                data = json.loads(lock_path.read_text(encoding="utf-8-sig"))
                if data.get("pid") == os.getpid():
                    lock_path.unlink()
                    _log.info("Agent lock released.")
                else:
                    _log.warning("Lock PID mismatch — not removing (another agent holds it).")
            except Exception:
                lock_path.unlink()
    except Exception as exc:
        _log.warning("Failed to release agent lock: %s", exc)


def read_heartbeat() -> Optional[dict]:
    """Read the current heartbeat file, or None if not running."""
    hb_path = _heartbeat_path()
    if not hb_path.exists():
        return None
    try:
        return json.loads(hb_path.read_text(encoding="utf-8-sig"))
    except Exception:
        return None


def write_heartbeat(
    status: str,
    started_at: str,
    qb_status: str = "Unknown",
    activity_log_status: str = "Waiting",
    timeline_status: str = "Waiting",
    auto_sync_status: str = "Off",
    last_error: str = "",
) -> None:
    """Write a heartbeat file for the running agent."""
    from pathlib import Path
    hb_path = _heartbeat_path()
    hb_path.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "status": status,
        "started_at": started_at,
        "last_heartbeat_at": _utc_now_iso(),
        "pid": os.getpid(),
        "mode": "background",
        "qb_status": qb_status,
        "activity_log_status": activity_log_status,
        "timeline_status": timeline_status,
        "auto_sync_status": auto_sync_status,
        "last_error": last_error,
    }
    try:
        hb_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception as exc:
        _log.warning("Failed to write heartbeat: %s", exc)


def _utc_now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
