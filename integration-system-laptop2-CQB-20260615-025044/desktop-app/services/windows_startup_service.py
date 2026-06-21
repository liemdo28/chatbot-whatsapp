"""
Windows Startup Service
========================
Manages the ToastPOSManager background agent to run at Windows logon.

Uses Windows Task Scheduler (schtasks.exe) for robust startup registration.

Scheduled task:
    Task Name: ToastPOSManagerBackgroundAgent
    Trigger: At user logon
    Action: <exe_path> --background
    Run only when user is logged on
    Restart on failure: enabled
    Delay: 30 seconds
"""

from __future__ import annotations

import logging
import subprocess
import sys
from pathlib import Path
from typing import Optional

_log = logging.getLogger(__name__)

TASK_NAME = "ToastPOSManagerBackgroundAgent"


def _get_exe_path() -> str:
    """Return the path to the current executable."""
    if getattr(sys, "frozen", False):
        return sys.executable
    # Development: use the pythonw executable path
    return sys.executable


def _get_task_xml_install(delay_seconds: int = 30) -> str:
    """
    Generate Task Scheduler XML for installing the startup task.
    Uses logon trigger with 30-second delay.
    """
    exe_path = _get_exe_path()
    return f"""<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Toast POS Manager - Background Agent</Description>
    <Author>ToastPOSManager</Author>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Delay>PT{delay_seconds}S</Delay>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <DeleteExpiredTaskAfterTask>PT1H</DeleteExpiredTaskAfterTask>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{exe_path}</Command>
      <Arguments>--background</Arguments>
    </Exec>
  </Actions>
</Task>"""


def _run_schtasks(args: list[str]) -> tuple[int, str, str]:
    """
    Run schtasks.exe and return (returncode, stdout, stderr).
    """
    try:
        result = subprocess.run(
            ["schtasks.exe"] + args,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        return result.returncode, result.stdout, result.stderr
    except FileNotFoundError:
        return -1, "", "schtasks.exe not found"
    except Exception as exc:
        return -1, "", str(exc)


def is_startup_installed() -> bool:
    """Return True if the startup scheduled task is registered."""
    _, stdout, _ = _run_schtasks(["/Query", "/TN", TASK_NAME, "/FO", "LIST"])
    return "ToastPOSManagerBackgroundAgent" in stdout


def install_startup(delay_seconds: int = 30) -> tuple[bool, str]:
    """
    Install the startup task. Creates a scheduled task that runs
    ToastPOSManager.exe --background at user logon.

    Returns (success, message).
    """
    try:
        # First, try to delete existing task (ignore error if not present)
        _run_schtasks(["/Delete", "/TN", TASK_NAME, "/F"])

        # Create the task using XML
        xml_content = _get_task_xml_install(delay_seconds)
        import tempfile
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".xml", delete=False, encoding="utf-16"
        ) as f:
            f.write(xml_content)
            xml_path = f.name

        try:
            rc, out, err = _run_schtasks([
                "/Create",
                "/TN", TASK_NAME,
                "/XML", xml_path,
            ])

            if rc == 0:
                _log.info("Startup task installed successfully.")
                return True, "Startup task installed. Agent will run after next login (30s delay)."
            else:
                # Fallback: use schtasks /SC ONEVENT (less ideal but works)
                _log.warning("XML task creation failed (%s). Trying inline creation.", err)
                rc2, out2, err2 = _run_schtasks([
                    "/Create",
                    "/TN", TASK_NAME,
                    "/TR", f'"{_get_exe_path()}" --background',
                    "/SC", "ONLOGON",
                    "/F",
                ])
                if rc2 == 0:
                    return True, "Startup task installed (inline mode)."
                return False, f"schtasks failed: {err or err2}"
        finally:
            try:
                Path(xml_path).unlink(missing_ok=True)
            except Exception:
                pass
    except Exception as exc:
        _log.error("install_startup failed: %s", exc)
        return False, str(exc)


def uninstall_startup() -> tuple[bool, str]:
    """
    Remove the startup scheduled task.

    Returns (success, message).
    """
    try:
        rc, out, err = _run_schtasks(["/Delete", "/TN", TASK_NAME, "/F"])
        if rc == 0:
            _log.info("Startup task removed.")
            return True, "Startup task removed. Agent will not run at logon."
        else:
            if "does not exist" in out.lower() or "does not exist" in err.lower():
                return True, "Startup task was not installed."
            return False, f"schtasks delete failed: {err or out}"
    except Exception as exc:
        _log.error("uninstall_startup failed: %s", exc)
        return False, str(exc)


def get_startup_status() -> dict:
    """
    Return dict with startup registration status.
    """
    installed = is_startup_installed()
    exe_path = _get_exe_path()
    return {
        "task_name": TASK_NAME,
        "installed": installed,
        "exe_path": exe_path,
        "trigger": "At user logon (30s delay)",
        "action": f'"{exe_path}" --background',
    }