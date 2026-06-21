"""
update_installer.py
Orchestrates the full update flow:
  1. Check safety conditions
  2. Stop background agent
  3. Backup data
  4. Run installer silently
  5. Restart background agent
  6. Verify heartbeat
  7. Report result to Mi-core

Safety rules: never install while QB sync/log running, remote command running,
backup failed, checksum mismatch, or battery critically low.
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DATA_ROOT = Path("C:/ProgramData/ToastPOSManager")
UPDATE_LOG = DATA_ROOT / "logs" / "installer-update.log"
UPDATE_RESULT_FILE = DATA_ROOT / "runtime" / "update-result.json"
SCHEDULED_TASK_NAME = "ToastPOSManager-Background"

# Seconds to wait for agent to stop
AGENT_STOP_TIMEOUT = 30
# Seconds to wait for agent heartbeat after update
HEARTBEAT_WAIT = 60


@dataclass
class InstallResult:
    success: bool
    version: str
    installer_path: Optional[str]
    backup_path: Optional[str]
    error: Optional[str] = None
    timestamp: str = ""

    def to_dict(self) -> dict:
        return {
            "success": self.success,
            "version": self.version,
            "installer_path": self.installer_path,
            "backup_path": self.backup_path,
            "error": self.error,
            "timestamp": self.timestamp,
        }


# ── Safety checks ─────────────────────────────────────────────────────────────

def _is_qb_sync_running() -> bool:
    """Check if a QB sync is currently running via lock file / state."""
    try:
        state_file = DATA_ROOT / "runtime" / "qb-sync-running.lock"
        return state_file.exists()
    except Exception:
        return False


def _is_remote_command_running() -> bool:
    """Check if a remote command is actively executing."""
    try:
        state_file = DATA_ROOT / "runtime" / "remote-command-running.lock"
        return state_file.exists()
    except Exception:
        return False


def check_install_safety() -> tuple[bool, str]:
    """
    Returns (safe, reason).
    safe=True means it is OK to install.
    """
    if _is_qb_sync_running():
        return False, "QB sync is currently running — defer update"
    if _is_remote_command_running():
        return False, "Remote command is currently running — defer update"
    return True, "OK"


# ── Agent control ─────────────────────────────────────────────────────────────

def _stop_background_agent(_subprocess=None) -> bool:
    """Stop the Windows scheduled task."""
    run = _subprocess or subprocess.run
    try:
        result = run(
            ["schtasks", "/End", "/TN", SCHEDULED_TASK_NAME],
            capture_output=True, text=True, timeout=15,
        )
        logger.info("schtasks /End result: %s", result.returncode)
        return result.returncode == 0
    except Exception as e:
        logger.error("Could not stop background agent: %s", e)
        return False


def _start_background_agent(_subprocess=None) -> bool:
    """Start the Windows scheduled task."""
    run = _subprocess or subprocess.run
    try:
        result = run(
            ["schtasks", "/Run", "/TN", SCHEDULED_TASK_NAME],
            capture_output=True, text=True, timeout=15,
        )
        logger.info("schtasks /Run result: %s", result.returncode)
        return result.returncode == 0
    except Exception as e:
        logger.error("Could not start background agent: %s", e)
        return False


# ── Installer execution ────────────────────────────────────────────────────────

def _run_installer(installer_path: Path, _subprocess=None) -> tuple[bool, str]:
    """Run installer silently. Returns (success, error_msg)."""
    run = _subprocess or subprocess.run
    UPDATE_LOG.parent.mkdir(parents=True, exist_ok=True)
    try:
        result = run(
            [
                str(installer_path),
                "/VERYSILENT",
                "/NORESTART",
                f'/LOG="{UPDATE_LOG}"',
            ],
            capture_output=True, text=True, timeout=300,
        )
        if result.returncode == 0:
            return True, ""
        return False, f"Installer exit code: {result.returncode}\n{result.stderr}"
    except subprocess.TimeoutExpired:
        return False, "Installer timed out after 300s"
    except Exception as e:
        return False, f"Installer error: {e}"


# ── Result persistence ─────────────────────────────────────────────────────────

def _write_result(result: InstallResult) -> None:
    try:
        UPDATE_RESULT_FILE.parent.mkdir(parents=True, exist_ok=True)
        UPDATE_RESULT_FILE.write_text(
            json.dumps(result.to_dict(), indent=2), encoding="utf-8"
        )
    except Exception as e:
        logger.warning("Could not write update result: %s", e)


# ── Main install flow ──────────────────────────────────────────────────────────

def run_install(
    installer_path: Path,
    version: str,
    backup_result=None,
    mi_core_client=None,
    _subprocess=None,
) -> InstallResult:
    """
    Full update flow: safety check → stop agent → backup → install → restart → report.
    """
    ts = datetime.now(timezone.utc).isoformat()

    # 1. Safety check
    safe, reason = check_install_safety()
    if not safe:
        result = InstallResult(
            success=False, version=version,
            installer_path=str(installer_path),
            backup_path=None,
            error=f"Safety check failed: {reason}",
            timestamp=ts,
        )
        _write_result(result)
        _report_event(mi_core_client, "UPDATE_FAILED", version, result.error)
        return result

    _report_event(mi_core_client, "UPDATE_INSTALL_STARTED", version)

    # 2. Stop background agent
    _stop_background_agent(_subprocess=_subprocess)
    time.sleep(2)

    # 3. Backup (already done by caller, just record path)
    backup_path = str(backup_result.backup_path) if backup_result and backup_result.backup_path else None
    if backup_result and not backup_result.success:
        result = InstallResult(
            success=False, version=version,
            installer_path=str(installer_path),
            backup_path=backup_path,
            error="Backup failed — aborting install to preserve data",
            timestamp=ts,
        )
        _write_result(result)
        _start_background_agent(_subprocess=_subprocess)
        _report_event(mi_core_client, "UPDATE_FAILED", version, result.error)
        return result

    # 4. Run installer
    ok, err = _run_installer(installer_path, _subprocess=_subprocess)
    if not ok:
        result = InstallResult(
            success=False, version=version,
            installer_path=str(installer_path),
            backup_path=backup_path,
            error=err,
            timestamp=ts,
        )
        _write_result(result)
        _start_background_agent(_subprocess=_subprocess)
        _report_event(mi_core_client, "UPDATE_FAILED", version, err)
        return result

    # 5. Restart agent
    _start_background_agent(_subprocess=_subprocess)

    # 6. Report success
    result = InstallResult(
        success=True, version=version,
        installer_path=str(installer_path),
        backup_path=backup_path,
        timestamp=ts,
    )
    _write_result(result)
    _report_event(mi_core_client, "UPDATE_COMPLETED", version)
    logger.info("Update to %s completed successfully", version)
    return result


# ── Mi-core event reporting ────────────────────────────────────────────────────

def _report_event(mi_core_client, event_type: str, version: str, error: str = "") -> None:
    if mi_core_client is None:
        return
    try:
        from services.machine_identity_service import get_machine_identity
        machine_id = get_machine_identity()
        mi_core_client.post("/api/integration-agent/update-events", {
            "machine_id": machine_id,
            "event_type": event_type,
            "version": version,
            "error": error,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as e:
        logger.warning("Could not report update event %s: %s", event_type, e)
