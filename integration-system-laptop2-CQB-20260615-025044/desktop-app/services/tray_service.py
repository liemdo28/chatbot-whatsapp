"""
Tray Service
=============
System tray integration for Toast POS Manager.

When user closes the main window, the app stays alive via the background agent.
The tray icon provides quick access to common actions.

Menu items:
- Open Dashboard (re-show the main window)
- Generate QB Activity Log Now
- Generate Timeline Now
- Open Log Folder
- Restart Background Agent
- Exit UI
- Stop Background Agent

If pystray is not available, falls back to a close-message dialog.
"""

from __future__ import annotations

import logging
import threading
from typing import Callable, Optional

_log = logging.getLogger(__name__)

# ── pystray availability ──────────────────────────────────────────────────────
_pystray = None
_PIL = None

try:
    import pystray
    import PIL.Image
    import PIL.ImageDraw
    _pystray = pystray
    _PIL = PIL
except ImportError:
    _log.warning("pystray not installed — system tray will not be available.")
    _pystray = None


def _create_default_icon() -> Optional[object]:
    """Create a simple default icon image if none available."""
    if _PIL is None:
        return None
    try:
        # Create a 64x64 blue square with "T" text
        img = _PIL.Image.new("RGB", (64, 64), color=(30, 60, 120))
        draw = _PIL.ImageDraw.Draw(img)
        # Draw text "T" in white
        from PIL import ImageFont
        try:
            font = _PIL.ImageFont.truetype("arial.ttf", 32)
        except Exception:
            font = None
        draw.text((16, 8), "T", fill=(255, 255, 255), font=font)
        return img
    except Exception as exc:
        _log.warning("Could not create default tray icon: %s", exc)
        return None


class TrayService:
    """
    System tray service.

    On Windows with pystray, creates a tray icon with a context menu.
    Falls back to no-op if pystray unavailable.
    """

    def __init__(
        self,
        on_open_dashboard: Optional[Callable[[], None]] = None,
        on_generate_activity_log: Optional[Callable[[], None]] = None,
        on_generate_timeline: Optional[Callable[[], None]] = None,
        on_open_log_folder: Optional[Callable[[], None]] = None,
        on_restart_agent: Optional[Callable[[], None]] = None,
        on_exit_ui: Optional[Callable[[], None]] = None,
        on_stop_agent: Optional[Callable[[], None]] = None,
    ):
        self._on_open_dashboard = on_open_dashboard
        self._on_generate_activity_log = on_generate_activity_log
        self._on_generate_timeline = on_generate_timeline
        self._on_open_log_folder = on_open_log_folder
        self._on_restart_agent = on_restart_agent
        self._on_exit_ui = on_exit_ui
        self._on_stop_agent = on_stop_agent

        self._tray: Optional[object] = None
        self._thread: Optional[threading.Thread] = None
        self._running = False

    def start(self) -> None:
        """Start the tray icon in a background thread."""
        if _pystray is None:
            _log.info("TrayService: pystray not available — skipping tray icon.")
            return

        if self._running:
            return

        self._running = True
        self._thread = threading.Thread(target=self._run_tray, daemon=True, name="tray-service")
        self._thread.start()
        _log.info("TrayService: started in background thread.")

    def stop(self) -> None:
        """Stop and remove the tray icon."""
        self._running = False
        if self._tray is not None:
            try:
                self._tray.stop()
            except Exception:
                pass
            self._tray = None
        _log.info("TrayService: stopped.")

    def _run_tray(self) -> None:
        """Run the tray icon loop (blocking)."""
        try:
            icon_image = _create_default_icon()
            if icon_image is None:
                _log.warning("TrayService: could not create icon — aborting.")
                return

            menu = _pystray.Menu(
                _pystray.MenuItem("Open Dashboard", self._on_open_dashboard_click),
                _pystray.MenuItem("Generate QB Activity Log Now", self._on_generate_activity_log_click),
                _pystray.MenuItem("Generate Timeline Now", self._on_generate_timeline_click),
                _pystray.MenuItem("Open Log Folder", self._on_open_log_folder_click),
                _pystray.MenuItem("Restart Background Agent", self._on_restart_agent_click),
                _pystray.Menu.SEPARATOR,
                _pystray.MenuItem("Exit UI", self._on_exit_ui_click),
                _pystray.MenuItem("Stop Background Agent", self._on_stop_agent_click),
            )

            self._tray = _pystray.Icon(
                "ToastPOSManager",
                icon_image,
                "Toast POS Manager - Background Agent Running",
                menu,
            )
            self._tray.run_detached()
            _log.info("TrayService: icon running.")
        except Exception as exc:
            _log.warning("TrayService: failed to start tray icon: %s", exc)

    # ── Menu action handlers ─────────────────────────────────────────────────

    def _on_open_dashboard_click(self, icon=None, item=None) -> None:
        if callable(self._on_open_dashboard):
            try:
                self._on_open_dashboard()
            except Exception as exc:
                _log.warning("on_open_dashboard callback error: %s", exc)

    def _on_generate_activity_log_click(self, icon=None, item=None) -> None:
        if callable(self._on_generate_activity_log):
            try:
                self._on_generate_activity_log()
            except Exception as exc:
                _log.warning("on_generate_activity_log callback error: %s", exc)

    def _on_generate_timeline_click(self, icon=None, item=None) -> None:
        if callable(self._on_generate_timeline):
            try:
                self._on_generate_timeline()
            except Exception as exc:
                _log.warning("on_generate_timeline callback error: %s", exc)

    def _on_open_log_folder_click(self, icon=None, item=None) -> None:
        if callable(self._on_open_log_folder):
            try:
                self._on_open_log_folder()
            except Exception as exc:
                _log.warning("on_open_log_folder callback error: %s", exc)

    def _on_restart_agent_click(self, icon=None, item=None) -> None:
        if callable(self._on_restart_agent):
            try:
                self._on_restart_agent()
            except Exception as exc:
                _log.warning("on_restart_agent callback error: %s", exc)

    def _on_exit_ui_click(self, icon=None, item=None) -> None:
        if callable(self._on_exit_ui):
            try:
                self._on_exit_ui()
            except Exception as exc:
                _log.warning("on_exit_ui callback error: %s", exc)

    def _on_stop_agent_click(self, icon=None, item=None) -> None:
        if callable(self._on_stop_agent):
            try:
                self._on_stop_agent()
            except Exception as exc:
                _log.warning("on_stop_agent callback error: %s", exc)


# ── Convenience: show close warning dialog ────────────────────────────────────

def show_close_warning() -> bool:
    """
    Show a warning dialog when user tries to close the UI while agent is running.
    Returns True if user confirmed they want to close, False otherwise.

    On tkinter unavailable, returns True (allow close).
    """
    try:
        import tkinter as tk
        from tkinter import messagebox
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        result = messagebox.askyesno(
            "Close Toast POS Manager?",
            "Background agent is still running.\n"
            "Logs and QB checks will continue in the background.\n\n"
            "Do you want to close the window?\n"
            "(The background agent will keep running.)",
        )
        root.destroy()
        return result
    except Exception:
        return True  # If tkinter fails, allow close


def open_log_folder() -> None:
    """Open the log folder in Windows Explorer."""
    try:
        from app_paths import runtime_path
        log_dir = runtime_path("logs")
        log_dir.mkdir(parents=True, exist_ok=True)
        import subprocess
        if sys.platform == "win32":
            subprocess.Popen(f'explorer "{log_dir}"', creationflags=0x08000000)
        else:
            subprocess.run(["xdg-open", str(log_dir)])
    except Exception as exc:
        _log.warning("open_log_folder failed: %s", exc)


import sys