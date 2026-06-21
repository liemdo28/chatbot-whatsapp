"""
first_run_wizard.py
====================
First-run setup wizard. Shows on first launch or when configuration is incomplete.
Configures: Mi-core URL/API key, machine ID, QuickBooks file scan, 12h sync schedule.
Writes results to local-config.json.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from typing import Optional
from json_file_utils import load_json_file

logger = logging.getLogger("first_run_wizard")

try:
    from app_paths import RUNTIME_DIR
except ImportError:
    RUNTIME_DIR = Path(__file__).resolve().parent.parent

LOCAL_CONFIG_PATH = RUNTIME_DIR / "local-config.json"


def _load_config() -> dict:
    if LOCAL_CONFIG_PATH.exists():
        try:
            return load_json_file(LOCAL_CONFIG_PATH)
        except Exception:
            pass
    return {}


def _save_config(config: dict) -> None:
    LOCAL_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOCAL_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)


def needs_first_run_wizard() -> bool:
    """Return True if wizard should be shown."""
    config = _load_config()
    mi_core = config.get("mi_core") or config.get("agent_coding", {})
    if not mi_core.get("enabled"):
        return True
    if not mi_core.get("base_url") or "localhost" in mi_core.get("base_url", ""):
        return True
    machine = config.get("machine", {})
    if not machine.get("machine_id"):
        return True
    return False


class FirstRunWizard:
    """Multi-step Tk wizard for initial configuration."""

    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("ToastPOSManager — First Run Setup")
        self.root.geometry("640x520")
        self.root.resizable(False, False)
        self.root.configure(bg="#1e1e2e")

        self._config = _load_config()
        self._found_files: list[dict] = []
        self._step = 0
        self._steps = [
            self._step_welcome,
            self._step_micore,
            self._step_machine,
            self._step_qb_files,
            self._step_schedule,
            self._step_done,
        ]

        # Variables
        self.var_base_url = tk.StringVar(value=self._get_existing("mi_core", "base_url", "http://100.x.x.x:4001"))
        self.var_api_key = tk.StringVar(value=os.environ.get("MI_CORE_API_KEY", ""))
        self.var_machine_id = tk.StringVar(value=self._get_existing("machine", "machine_id", "qb-laptop-01"))
        self.var_machine_name = tk.StringVar(value=self._get_existing("machine", "machine_name", "QB Laptop"))
        self.var_store_code = tk.StringVar(value=self._get_existing("machine", "store_code", ""))
        self.var_sync_enabled = tk.BooleanVar(value=True)
        self.var_run_on_startup = tk.BooleanVar(value=True)
        self.var_interval_hours = tk.IntVar(value=12)

        self._frame = tk.Frame(self.root, bg="#1e1e2e")
        self._frame.pack(fill="both", expand=True, padx=20, pady=20)
        self._nav_frame = tk.Frame(self.root, bg="#1e1e2e")
        self._nav_frame.pack(fill="x", padx=20, pady=(0, 16))

        self._render_step()

    def _get_existing(self, section: str, key: str, default: str = "") -> str:
        s = self._config.get(section, {})
        return str(s.get(key, default))

    def _clear_frame(self) -> None:
        for w in self._frame.winfo_children():
            w.destroy()
        for w in self._nav_frame.winfo_children():
            w.destroy()

    def _render_step(self) -> None:
        self._clear_frame()
        self._steps[self._step]()
        self._render_nav()

    def _render_nav(self) -> None:
        is_last = self._step == len(self._steps) - 1
        is_first = self._step == 0
        if not is_last:
            btn_next = tk.Button(
                self._nav_frame, text="Next →", command=self._next,
                bg="#6c63ff", fg="white", font=("Segoe UI", 11, "bold"),
                relief="flat", padx=20, pady=8, cursor="hand2",
            )
            btn_next.pack(side="right")
        if not is_first and not is_last:
            btn_back = tk.Button(
                self._nav_frame, text="← Back", command=self._back,
                bg="#3a3a5c", fg="white", font=("Segoe UI", 11),
                relief="flat", padx=16, pady=8, cursor="hand2",
            )
            btn_back.pack(side="right", padx=(0, 8))

    def _next(self) -> None:
        if not self._validate_current_step():
            return
        self._save_current_step()
        self._step = min(self._step + 1, len(self._steps) - 1)
        self._render_step()

    def _back(self) -> None:
        self._step = max(self._step - 1, 0)
        self._render_step()

    def _validate_current_step(self) -> bool:
        if self._step == 1:
            url = self.var_base_url.get().strip()
            if not url.startswith("http"):
                messagebox.showerror("Invalid URL", "Mi-core URL must start with http:// or https://")
                return False
            if not self.var_api_key.get().strip():
                messagebox.showerror("Missing API Key", "Please enter the Mi-core API key.")
                return False
        if self._step == 2:
            if not self.var_machine_id.get().strip():
                messagebox.showerror("Missing Machine ID", "Machine ID is required.")
                return False
        return True

    def _save_current_step(self) -> None:
        config = _load_config()

        if self._step == 1:
            config.setdefault("mi_core", {})
            config["mi_core"]["enabled"] = True
            config["mi_core"]["base_url"] = self.var_base_url.get().strip()
            config["mi_core"]["api_key_env"] = "MI_CORE_API_KEY"
            config["mi_core"]["app_version"] = "dev1-v2"
            config["mi_core"]["poll_commands_seconds"] = 60
            config["mi_core"]["heartbeat_seconds"] = 60
            config["mi_core"]["timeout_seconds"] = 15

            api_key = self.var_api_key.get().strip()
            if api_key:
                # Write to .env file alongside exe
                env_path = RUNTIME_DIR / ".env"
                _write_env_key(env_path, "MI_CORE_API_KEY", api_key)

        elif self._step == 2:
            config.setdefault("machine", {})
            config["machine"]["machine_id"] = self.var_machine_id.get().strip()
            config["machine"]["machine_name"] = self.var_machine_name.get().strip()
            config["machine"]["store_code"] = self.var_store_code.get().strip()
            if config.get("mi_core"):
                config["mi_core"]["machine_id"] = self.var_machine_id.get().strip()

        elif self._step == 4:
            config.setdefault("sync_schedule", {})
            config["sync_schedule"]["enabled"] = self.var_sync_enabled.get()
            config["sync_schedule"]["interval_hours"] = self.var_interval_hours.get()
            config["sync_schedule"]["run_on_startup"] = self.var_run_on_startup.get()
            config["sync_schedule"]["jitter_minutes"] = 10

        _save_config(config)
        self._config = config

    # ── Steps ──────────────────────────────────────────────────────────────────

    def _lbl(self, text: str, size: int = 11, bold: bool = False, color: str = "#cdd6f4") -> tk.Label:
        weight = "bold" if bold else "normal"
        return tk.Label(self._frame, text=text, font=("Segoe UI", size, weight),
                        bg="#1e1e2e", fg=color, justify="left", anchor="w")

    def _entry(self, var: tk.Variable, show: str = "") -> tk.Entry:
        e = tk.Entry(self._frame, textvariable=var, font=("Segoe UI", 11),
                     bg="#313244", fg="#cdd6f4", insertbackground="white",
                     relief="flat", show=show)
        e.configure(highlightthickness=1, highlightbackground="#6c63ff")
        return e

    def _step_welcome(self) -> None:
        self._lbl("Welcome to ToastPOSManager", 16, bold=True, color="#cba6f7").pack(anchor="w", pady=(0, 8))
        self._lbl("This wizard will help you connect to Mi-core\nand configure QuickBooks sync.", 12).pack(anchor="w", pady=(0, 20))
        steps_text = (
            "Steps:\n"
            "  1. Connect to Mi-core (central control)\n"
            "  2. Set machine identity\n"
            "  3. Detect QuickBooks company files\n"
            "  4. Schedule 12-hour auto-sync\n"
            "  5. Done!"
        )
        self._lbl(steps_text, 11, color="#a6e3a1").pack(anchor="w")

    def _step_micore(self) -> None:
        self._lbl("Mi-core Connection", 14, bold=True, color="#cba6f7").pack(anchor="w", pady=(0, 12))
        self._lbl("Mi-core URL (Tailscale IP):").pack(anchor="w")
        self._entry(self.var_base_url).pack(fill="x", pady=(2, 8))
        self._lbl("API Key:").pack(anchor="w")
        self._entry(self.var_api_key, show="*").pack(fill="x", pady=(2, 8))
        self._lbl("(API key will be saved to .env file, not plain text in config)", 9, color="#6c7086").pack(anchor="w")

        def test_conn():
            import urllib.request
            url = self.var_base_url.get().strip().rstrip("/") + "/api/qb-agent/ping"
            try:
                req = urllib.request.Request(url, headers={
                    "X-API-Key": self.var_api_key.get().strip()
                })
                with urllib.request.urlopen(req, timeout=5) as resp:
                    data = json.loads(resp.read())
                if data.get("ok"):
                    messagebox.showinfo("Connected", f"Mi-core is online!\nServer: {data.get('server','')}")
                else:
                    messagebox.showwarning("Unexpected", str(data))
            except Exception as e:
                messagebox.showerror("Connection Failed", str(e))

        tk.Button(self._frame, text="Test Connection", command=test_conn,
                  bg="#313244", fg="#89dceb", font=("Segoe UI", 10),
                  relief="flat", padx=12, pady=4, cursor="hand2").pack(anchor="w", pady=(8, 0))

    def _step_machine(self) -> None:
        self._lbl("Machine Identity", 14, bold=True, color="#cba6f7").pack(anchor="w", pady=(0, 12))
        self._lbl("Machine ID (unique per PC):").pack(anchor="w")
        self._entry(self.var_machine_id).pack(fill="x", pady=(2, 8))
        self._lbl("Machine Name (display name):").pack(anchor="w")
        self._entry(self.var_machine_name).pack(fill="x", pady=(2, 8))
        self._lbl("Store Code (e.g. bandera):").pack(anchor="w")
        self._entry(self.var_store_code).pack(fill="x", pady=(2, 8))

    def _step_qb_files(self) -> None:
        self._lbl("QuickBooks Company Files", 14, bold=True, color="#cba6f7").pack(anchor="w", pady=(0, 12))
        self._lbl("Scan your drives for .QBW, .QBM, .QBB files.\nFound files will be added (disabled by default).\nYou can enable them in the main app.", 11).pack(anchor="w", pady=(0, 10))

        status_var = tk.StringVar(value="Click 'Scan Now' to find QB files.")
        status_lbl = tk.Label(self._frame, textvariable=status_var, font=("Segoe UI", 10),
                              bg="#1e1e2e", fg="#a6e3a1", justify="left", anchor="w", wraplength=540)
        status_lbl.pack(anchor="w", pady=(0, 8))

        listbox = tk.Listbox(self._frame, bg="#313244", fg="#cdd6f4", font=("Segoe UI", 10),
                             selectmode="extended", height=8, relief="flat")
        listbox.pack(fill="both", expand=True, pady=(0, 8))

        def do_scan():
            status_var.set("Scanning… this may take a moment.")
            listbox.delete(0, "end")
            self.root.update_idletasks()

            def _scan():
                from services.qb_file_scanner import scan_roots
                from services.qb_file_registry import add_scanned_files, get_all_files
                found = scan_roots()
                self._found_files = [f.to_dict() for f in found]
                added = add_scanned_files(found)
                self.root.after(0, lambda: _update_ui(found, added))

            def _update_ui(found, added):
                listbox.delete(0, "end")
                for f in found:
                    listbox.insert("end", f"  {f.file_name}  →  {f.file_path}")
                status_var.set(f"Found {len(found)} file(s). Added {added} new to registry.")

            threading.Thread(target=_scan, daemon=True).start()

        tk.Button(self._frame, text="Scan Now", command=do_scan,
                  bg="#6c63ff", fg="white", font=("Segoe UI", 10, "bold"),
                  relief="flat", padx=14, pady=4, cursor="hand2").pack(anchor="w")

    def _step_schedule(self) -> None:
        self._lbl("12-Hour Sync Schedule", 14, bold=True, color="#cba6f7").pack(anchor="w", pady=(0, 12))
        tk.Checkbutton(self._frame, text="Enable 12-hour auto-sync", variable=self.var_sync_enabled,
                       bg="#1e1e2e", fg="#cdd6f4", selectcolor="#313244",
                       font=("Segoe UI", 11), activebackground="#1e1e2e").pack(anchor="w", pady=(0, 6))
        tk.Checkbutton(self._frame, text="Run background agent on Windows startup",
                       variable=self.var_run_on_startup,
                       bg="#1e1e2e", fg="#cdd6f4", selectcolor="#313244",
                       font=("Segoe UI", 11), activebackground="#1e1e2e").pack(anchor="w", pady=(0, 12))
        self._lbl("Sync interval (hours):").pack(anchor="w")
        spin = tk.Spinbox(self._frame, from_=1, to=24, textvariable=self.var_interval_hours,
                          font=("Segoe UI", 11), bg="#313244", fg="#cdd6f4",
                          buttonbackground="#313244", relief="flat", width=6)
        spin.pack(anchor="w", pady=(2, 0))
        self._lbl("Jitter of ±10 minutes is applied to avoid thundering-herd.", 9, color="#6c7086").pack(anchor="w", pady=(4, 0))

    def _step_done(self) -> None:
        self._lbl("Setup Complete!", 16, bold=True, color="#a6e3a1").pack(anchor="w", pady=(0, 12))
        self._lbl("Configuration saved. The background agent will start shortly.\n\n"
                  "You can re-run this wizard from Settings at any time.", 12).pack(anchor="w")

        def finish():
            if self.var_run_on_startup.get():
                try:
                    from services.windows_startup_service import install_startup_task
                    install_startup_task()
                except Exception as e:
                    logger.warning("Could not install startup task: %s", e)
            self.root.destroy()

        tk.Button(self._frame, text="Finish", command=finish,
                  bg="#6c63ff", fg="white", font=("Segoe UI", 12, "bold"),
                  relief="flat", padx=24, pady=10, cursor="hand2").pack(pady=(20, 0))


def _write_env_key(env_path: Path, key: str, value: str) -> None:
    lines = []
    if env_path.exists():
        with open(env_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
    updated = False
    for i, line in enumerate(lines):
        if line.startswith(f"{key}="):
            lines[i] = f"{key}={value}\n"
            updated = True
            break
    if not updated:
        lines.append(f"{key}={value}\n")
    with open(env_path, "w", encoding="utf-8") as f:
        f.writelines(lines)


def run_wizard_if_needed() -> bool:
    """Run the wizard in a new Tk window if configuration is incomplete. Returns True if wizard ran."""
    if not needs_first_run_wizard():
        return False
    root = tk.Tk()
    wizard = FirstRunWizard(root)
    root.mainloop()
    return True


def run_wizard_always() -> None:
    """Force-run the wizard regardless of config state."""
    root = tk.Tk()
    FirstRunWizard(root)
    root.mainloop()
