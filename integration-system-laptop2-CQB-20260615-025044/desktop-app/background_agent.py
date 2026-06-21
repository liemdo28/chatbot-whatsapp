"""
ToastPOSManager — Background Agent Entry Point
===============================================
Runs when: ToastPOSManager.exe --background

Runs headless:
- Starts QB startup service
- Starts QB activity log scheduler
- Starts QB activity timeline scheduler
- Starts auto report sync scheduler
- Writes heartbeat every 60 seconds
- Processes command queue every 10 seconds

The agent:
- Does NOT show a window
- Writes logs to runtime/logs/
- Creates/updates runtime/agent-heartbeat.json
- Responds to commands in runtime/agent-commands/

Exit cleanly:
- On SIGINT / SIGTERM (Ctrl+C)
- On command STOP_AGENT
- On stop file (runtime/agent-stop.txt)
"""

from __future__ import annotations

import logging
import os
import signal
import sys
import threading
import time
from pathlib import Path
from json_file_utils import load_json_file

# ── Hide console window immediately (Windows only) ────────────────────────────
# Runs BEFORE anything else so the cmd window never flashes on screen.
# Works whether launched via: python, pythonw, scheduled task, or double-click.
def _hide_console_window() -> None:
    """Hide the console window so the agent runs fully invisible."""
    try:
        import ctypes
        # GetConsoleWindow() returns NULL if there is no console (pythonw.exe) — safe no-op
        hwnd = ctypes.windll.kernel32.GetConsoleWindow()
        if hwnd:
            ctypes.windll.user32.ShowWindow(hwnd, 0)  # SW_HIDE = 0
    except Exception:
        pass  # Never crash — hiding is cosmetic

_hide_console_window()

# ── Setup logging before anything else ───────────────────────────────────────
_log_setup_done = False


def _setup_logging() -> None:
    global _log_setup_done
    if _log_setup_done:
        return
    _log_setup_done = True

    # Ensure runtime/logs exists
    try:
        from app_paths import runtime_path
        log_dir = runtime_path("logs")
        log_dir.mkdir(parents=True, exist_ok=True)
        log_file = log_dir / f"agent_{Path(__file__).stem}.log"
    except Exception:
        log_dir = Path("logs")
        log_dir.mkdir(parents=True, exist_ok=True)
        log_file = log_dir / "background_agent.log"

    stream = sys.stderr if sys.stderr is not None else open(os.devnull, "w", encoding="utf-8")

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] [Agent] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[
            logging.FileHandler(log_file, encoding="utf-8"),
            logging.StreamHandler(stream),
        ],
    )


# ── Single instance check ──────────────────────────────────────────────────────

def _check_single_instance() -> bool:
    try:
        from services.app_single_instance import acquire_agent_lock, is_agent_running
        if is_agent_running():
            logging.error("Another agent is already running. Exiting.")
            return False
        if not acquire_agent_lock(mode="background"):
            logging.error("Failed to acquire agent lock. Exiting.")
            return False
        return True
    except Exception as exc:
        logging.error("Single instance check failed: %s", exc)
        return False


def _release_lock() -> None:
    try:
        from services.app_single_instance import release_agent_lock
        release_agent_lock()
    except Exception:
        pass


# ── Stop file watcher ──────────────────────────────────────────────────────────

_stop_requested = threading.Event()


def _stop_file_watcher() -> None:
    """Watch for runtime/agent-stop.txt and stop when found."""
    while not _stop_requested.is_set():
        try:
            from app_paths import runtime_path
            stop_file = runtime_path("runtime") / "agent-stop.txt"
            if stop_file.exists():
                logging.info("Stop file detected. Shutting down...")
                _stop_requested.set()
                return
        except Exception:
            pass
        time.sleep(2)


# ── Signal handlers ───────────────────────────────────────────────────────────

def _on_sigterm(signum, frame) -> None:
    logging.info("SIGTERM received — shutting down gracefully.")
    _stop_requested.set()


def _on_sigint(signum, frame) -> None:
    logging.info("SIGINT received — shutting down gracefully.")
    _stop_requested.set()


# ── Main background agent ──────────────────────────────────────────────────────

def _main() -> int:
    _setup_logging()
    logging.info("=== ToastPOSManager Background Agent starting ===")
    logging.info("sys.executable=%s", sys.executable)
    logging.info("frozen=%s", getattr(sys, "frozen", False))

    # Register signal handlers
    try:
        signal.signal(signal.SIGTERM, _on_sigterm)
        signal.signal(signal.SIGINT, _on_sigint)
    except Exception:
        pass  # Not all platforms support SIGTERM

    # Single instance
    if not _check_single_instance():
        return 1

    # Load config
    config = {}
    try:
        from app_paths import runtime_path
        cfg_path = runtime_path("local-config.json")
        if cfg_path.exists():
            config = load_json_file(cfg_path)
    except Exception as exc:
        logging.warning("Could not load local-config.json: %s", exc)

    # Get heartbeat interval
    bg_agent_cfg = config.get("background_agent", {})
    heartbeat_seconds = int(bg_agent_cfg.get("heartbeat_seconds") or 60)
    logging.info("Heartbeat interval: %d seconds", heartbeat_seconds)

    # Start stop file watcher
    watcher_thread = threading.Thread(target=_stop_file_watcher, daemon=True, name="stop-watcher")
    watcher_thread.start()

    # Start the background agent service
    agent = None
    try:
        from services.background_agent_service import run_background_agent
        agent = run_background_agent(
            config=config,
            heartbeat_seconds=heartbeat_seconds,
            command_poll_seconds=10,
        )
        logging.info("Background agent service started (PID=%s)", os.getpid())
    except Exception as exc:
        logging.error("Failed to start background agent service: %s", exc)
        _release_lock()
        return 1

    # Also start Agent-Coding integration (heartbeat + command polling + outbox)
    rc_scheduler = None
    try:
        from services.remote_control_scheduler import start_background_agent as start_rc
        rc_scheduler = start_rc()
        logging.info("Agent-Coding RemoteControlScheduler started.")
    except Exception as exc:
        logging.warning("RemoteControlScheduler failed to start: %s (continuing without Agent-Coding)", exc)

    # Check release metadata periodically. It reports availability only; install still requires admin approval.
    update_scheduler = None
    try:
        from services.mi_core_client import get_client as get_mi_core_client
        from services.update_scheduler import start_update_scheduler
        update_scheduler = start_update_scheduler(mi_core_client=get_mi_core_client())
        logging.info("UpdateScheduler started.")
    except Exception as exc:
        logging.warning("UpdateScheduler failed to start: %s (continuing without auto-update checks)", exc)

    # Write initial heartbeat
    try:
        from services.app_single_instance import write_heartbeat
        write_heartbeat(
            status="AGENT_RUNNING",
            started_at=_utc_now_iso(),
            qb_status="Unknown",
            activity_log_status="Waiting",
            timeline_status="Waiting",
            auto_sync_status="Off",
            last_error="",
        )
    except Exception as exc:
        logging.warning("Initial heartbeat write failed: %s", exc)

    # Wait for stop signal
    try:
        while not _stop_requested.is_set():
            # Check if agent is still running
            time.sleep(5)
            if _stop_requested.is_set():
                break
            # Re-check lock (in case another process tried to start)
            try:
                from services.app_single_instance import is_agent_running
                if not is_agent_running():
                    logging.warning("Agent lock lost — shutting down.")
                    break
            except Exception:
                pass
    except KeyboardInterrupt:
        logging.info("Keyboard interrupt — shutting down.")
    finally:
        logging.info("Stopping background agent...")
        try:
            agent.stop()
        except Exception:
            pass
        try:
            if update_scheduler is not None:
                update_scheduler.stop()
        except Exception:
            pass
        try:
            if rc_scheduler is not None:
                rc_scheduler.stop()
        except Exception:
            pass
        _release_lock()
        logging.info("Background agent stopped.")

    return 0


def _utc_now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def main() -> int:
    """Entry point for launcher.py."""
    return _main()


if __name__ == "__main__":
    sys.exit(main())
