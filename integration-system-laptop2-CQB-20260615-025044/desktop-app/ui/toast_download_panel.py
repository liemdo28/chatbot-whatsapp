"""Toast Download Automation panel."""

from __future__ import annotations

import json
import os
import subprocess
import threading
from datetime import date, timedelta
from pathlib import Path

try:
    import customtkinter as ctk
except ImportError:  # pragma: no cover
    ctk = None

from app_paths import runtime_path
from json_file_utils import load_json_file
from services.toast_browser_agent import (
    AUTOMATION_BROWSER_USE_AGENT,
    AUTOMATION_HYBRID_FALLBACK,
    AUTOMATION_PLAYWRIGHT_STATIC,
    merge_toast_download_config,
    normalize_automation_mode,
)
from services.toast_browser_use_downloader import ToastBrowserUseDownloader
from services.toast_download_orchestrator import ToastDownloadRequest, run_toast_download
from services.toast_human_handoff import get_handoff_state, mark_login_completed


LOCAL_CONFIG_FILE = runtime_path("local-config.json")
MODES = [AUTOMATION_PLAYWRIGHT_STATIC, AUTOMATION_BROWSER_USE_AGENT, AUTOMATION_HYBRID_FALLBACK]


def _previous_business_day(today: date | None = None) -> str:
    current = today or date.today()
    current -= timedelta(days=1)
    while current.weekday() >= 5:
        current -= timedelta(days=1)
    return current.isoformat()


def _load_config() -> dict:
    if not LOCAL_CONFIG_FILE.exists():
        return {}
    try:
        return load_json_file(LOCAL_CONFIG_FILE)
    except Exception:
        return {}


def _save_config(config: dict) -> None:
    LOCAL_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    LOCAL_CONFIG_FILE.write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")


def _default_store(config: dict) -> str:
    machine = config.get("machine") or {}
    return (
        machine.get("store_name")
        or machine.get("location")
        or machine.get("store_code")
        or "Bandera"
    )


class ToastDownloadPanel(ctk.CTkFrame if ctk else object):
    def __init__(self, parent, status_var=None):
        super().__init__(parent, fg_color="transparent")
        self.status_var = status_var
        self._running = False
        self._status_labels: dict[str, object] = {}
        self._build()
        self.refresh_status()

    def _build(self) -> None:
        header = ctk.CTkFrame(self, fg_color="#0b1220", corner_radius=10, border_width=1, border_color="#1f2937")
        header.pack(fill="x", padx=16, pady=(16, 10))
        ctk.CTkLabel(
            header,
            text="Toast Download Automation",
            font=ctk.CTkFont(size=22, weight="bold"),
            text_color="#f8fafc",
        ).pack(anchor="w", padx=18, pady=(16, 4))
        ctk.CTkLabel(
            header,
            text="Hybrid report download control with Playwright primary and Browser-Use fallback.",
            font=ctk.CTkFont(size=12),
            text_color="#94a3b8",
        ).pack(anchor="w", padx=18, pady=(0, 16))

        body = ctk.CTkFrame(self, fg_color="#111827", corner_radius=10, border_width=1, border_color="#243044")
        body.pack(fill="both", expand=True, padx=16, pady=(0, 12))

        top = ctk.CTkFrame(body, fg_color="transparent")
        top.pack(fill="x", padx=16, pady=(16, 8))

        ctk.CTkLabel(top, text="Automation Mode", text_color="#cbd5e1", font=ctk.CTkFont(size=12, weight="bold")).grid(row=0, column=0, sticky="w")
        self.mode_menu = ctk.CTkOptionMenu(top, values=MODES, command=lambda _value: self._switch_mode())
        self.mode_menu.grid(row=1, column=0, sticky="w", pady=(6, 0), padx=(0, 12))

        button_bar = ctk.CTkFrame(top, fg_color="transparent")
        button_bar.grid(row=1, column=1, sticky="w", pady=(6, 0))
        ctk.CTkButton(button_bar, text="Test Toast Login", command=self.test_toast_login, width=140).pack(side="left", padx=(0, 8))
        ctk.CTkButton(button_bar, text="Download Report Now", command=self.download_report_now, width=165).pack(side="left", padx=(0, 8))
        ctk.CTkButton(button_bar, text="Open Download Folder", command=self.open_download_folder, width=160).pack(side="left", padx=(0, 8))
        ctk.CTkButton(button_bar, text="Human Login Completed", command=self.human_login_completed, width=175).pack(side="left")

        grid = ctk.CTkFrame(body, fg_color="transparent")
        grid.pack(fill="x", padx=16, pady=(8, 16))
        labels = [
            ("browser_use_installed", "Browser-Use Installed"),
            ("toast_login_status", "Toast Login Status"),
            ("last_download_status", "Last Download Status"),
            ("last_downloaded_file", "Last Downloaded File"),
            ("last_error", "Last Error"),
            ("human_required", "Human Required"),
        ]
        for idx, (key, title) in enumerate(labels):
            row = idx // 2
            col = idx % 2
            card = ctk.CTkFrame(grid, fg_color="#0f172a", corner_radius=8, border_width=1, border_color="#233047")
            card.grid(row=row, column=col, padx=(0 if col == 0 else 10, 0), pady=(0, 10), sticky="ew")
            grid.columnconfigure(col, weight=1)
            ctk.CTkLabel(card, text=title, text_color="#64748b", font=ctk.CTkFont(size=11, weight="bold")).pack(anchor="w", padx=12, pady=(10, 2))
            value = ctk.CTkLabel(card, text="—", text_color="#e2e8f0", font=ctk.CTkFont(size=12), wraplength=420, justify="left")
            value.pack(anchor="w", padx=12, pady=(0, 10))
            self._status_labels[key] = value

        self.log_box = ctk.CTkTextbox(body, height=190, font=ctk.CTkFont(family="Consolas", size=12))
        self.log_box.pack(fill="both", expand=True, padx=16, pady=(0, 16))
        self.log_box.configure(state="disabled")

    def _append_log(self, message: str) -> None:
        self.log_box.configure(state="normal")
        self.log_box.insert("end", f"{message}\n")
        self.log_box.see("end")
        self.log_box.configure(state="disabled")
        if self.status_var is not None:
            self.status_var.set(message[:120])

    def _set_value(self, key: str, value: str, color: str = "#e2e8f0") -> None:
        label = self._status_labels.get(key)
        if label:
            label.configure(text=value or "—", text_color=color)

    def refresh_status(self) -> None:
        config = _load_config()
        toast_cfg = merge_toast_download_config(config)
        mode = normalize_automation_mode(toast_cfg.get("automation_mode"))
        self.mode_menu.set(mode)

        installed, reason = ToastBrowserUseDownloader.is_available()
        self._set_value("browser_use_installed", "Yes" if installed else "No", "#86efac" if installed else "#fca5a5")

        handoff = get_handoff_state()
        if handoff.get("status") == "HUMAN_REQUIRED":
            self._set_value("toast_login_status", handoff.get("reason", "Human login required"), "#fbbf24")
            self._set_value("human_required", "Yes", "#fbbf24")
        elif handoff.get("status") == "LOGIN_COMPLETED":
            self._set_value("toast_login_status", "Operator confirmed login completed", "#86efac")
            self._set_value("human_required", "No", "#86efac")
        else:
            self._set_value("toast_login_status", "Not tested", "#cbd5e1")
            self._set_value("human_required", "No", "#86efac")

        self._set_value("last_download_status", "Ready")
        self._set_value("last_downloaded_file", "")
        self._set_value("last_error", "" if installed else reason, "#fca5a5" if not installed else "#e2e8f0")

    def _switch_mode(self) -> None:
        config = _load_config()
        config.setdefault("toast_download", {})["automation_mode"] = self.mode_menu.get()
        _save_config(config)
        self._append_log(f"Automation mode set to {self.mode_menu.get()}")
        self.refresh_status()

    def test_toast_login(self) -> None:
        installed, reason = ToastBrowserUseDownloader.is_available()
        if not installed:
            self._set_value("toast_login_status", "Browser-Use not installed", "#fca5a5")
            self._set_value("last_error", reason, "#fca5a5")
            self._append_log(f"Browser-Use not installed: {reason}")
            return
        if self._running:
            return
        self._running = True
        self._set_value("toast_login_status", "Testing Toast profile...", "#93c5fd")
        self._append_log("Testing Toast browser profile/login...")

        def _worker():
            try:
                config = _load_config()
                toast_cfg = merge_toast_download_config(config)
                downloader = ToastBrowserUseDownloader({"toast_download": toast_cfg}, on_log=self._append_log)
                result = downloader.test_toast_login(download_dir=toast_cfg.get("download_dir"))
                self.after(0, lambda: self._apply_login_result(result.to_dict()))
            except Exception as exc:
                self.after(0, lambda: self._apply_download_error(str(exc)))
            finally:
                self._running = False

        threading.Thread(target=_worker, daemon=True).start()

    def download_report_now(self) -> None:
        if self._running:
            return
        self._running = True
        self._set_value("last_download_status", "Running", "#93c5fd")
        self._append_log("Starting Toast download validation...")

        def _worker():
            try:
                config = _load_config()
                request = ToastDownloadRequest(
                    store=_default_store(config),
                    business_date=_previous_business_day(),
                    report_type="sales_summary",
                )
                result = run_toast_download(request, config=config, mi_core_client=None)
                self.after(0, lambda: self._apply_download_result(result.to_dict()))
            except Exception as exc:
                self.after(0, lambda: self._apply_download_error(str(exc)))
            finally:
                self._running = False

        threading.Thread(target=_worker, daemon=True).start()

    def _apply_download_result(self, result: dict) -> None:
        self._set_value("last_download_status", result.get("status", "Unknown"), "#86efac" if result.get("ok") else "#fbbf24")
        self._set_value("last_downloaded_file", result.get("file_path", ""))
        self._set_value("last_error", result.get("error", ""), "#fca5a5" if result.get("error") else "#e2e8f0")
        self._set_value("human_required", "Yes" if result.get("human_required") else "No", "#fbbf24" if result.get("human_required") else "#86efac")
        self._append_log(json.dumps(result, ensure_ascii=False))

    def _apply_download_error(self, error: str) -> None:
        self._set_value("last_download_status", "Failed", "#fca5a5")
        self._set_value("last_error", error, "#fca5a5")
        self._append_log(f"Download failed: {error}")

    def _apply_login_result(self, result: dict) -> None:
        status = result.get("status", "Unknown")
        human_required = bool(result.get("human_required"))
        if result.get("ok"):
            self._set_value("toast_login_status", "Toast dashboard reachable", "#86efac")
            self._set_value("human_required", "No", "#86efac")
        elif human_required:
            self._set_value("toast_login_status", "HUMAN_REQUIRED", "#fbbf24")
            self._set_value("human_required", "Yes", "#fbbf24")
        else:
            self._set_value("toast_login_status", status, "#fca5a5")
        self._set_value("last_error", result.get("error", ""), "#fca5a5" if result.get("error") else "#e2e8f0")
        self._append_log(json.dumps(result, ensure_ascii=False))

    def open_download_folder(self) -> None:
        config = _load_config()
        toast_cfg = merge_toast_download_config(config)
        folder = Path(toast_cfg.get("download_dir") or runtime_path("toast-reports"))
        folder.mkdir(parents=True, exist_ok=True)
        if os.name == "nt":
            subprocess.Popen(["explorer", str(folder)])
        else:
            subprocess.Popen(["open" if os.uname().sysname == "Darwin" else "xdg-open", str(folder)])

    def human_login_completed(self) -> None:
        payload = mark_login_completed()
        self._append_log("Human login completed marked.")
        self.refresh_status()
        self._set_value("toast_login_status", payload.get("status", "LOGIN_COMPLETED"), "#86efac")
