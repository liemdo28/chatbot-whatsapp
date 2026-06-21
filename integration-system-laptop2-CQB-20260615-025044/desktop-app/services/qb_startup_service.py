"""
QB Startup Service
==================
Runs non-blocking on app start:
  1. Reads QB config from local-config.json
  2. Checks if QB Desktop is running
  3. If not running → launches QB exe + opens company file
  4. If running wrong company → warns / switches (if allowed)
  5. Emits status updates via callback and writes to activity log
  6. Writes every state transition to activity log

Status values
-------------
  QB_CLOSED       — QB process not running
  QB_OPENING      — Subprocess launched, waiting for window
  QB_CONNECTING   — Window visible, opening company file
  QB_READY        — QB is open with the correct company
  QB_WRONG_CO     — QB is open but wrong company file
  QB_BLOCKED      — Cannot proceed (missing config, exe not found, etc.)
  QB_DISABLED     — auto_open_on_app_start = false

Config shape (local-config.json → "quickbooks" key):
-----------------------------------------------------
{
  "quickbooks": {
    "auto_open_on_app_start": true,
    "auto_connect_company_file": true,
    "allow_company_switch": false,
    "startup_timeout_seconds": 90,
    "exe_path": "C:\\Program Files\\Intuit\\...",   // optional override
    "company_file": "D:\\QB\\JHT Ventures.qbw",    // optional single-file override
    "password_key": "pass1"
  }
}
"""

from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

_log = logging.getLogger(__name__)

# ── Lazy-import QB automation (optional on non-Windows / test machines) ───────
try:
    from qb_automate import resolve_qb_executable, open_qb_with_file  # noqa: F401
except ImportError:
    resolve_qb_executable = None  # type: ignore[assignment]
    open_qb_with_file = None      # type: ignore[assignment]


# ── Status constants ──────────────────────────────────────────────────────────
QB_STATUS_CLOSED     = "QB_CLOSED"
QB_STATUS_OPENING    = "QB_OPENING"
QB_STATUS_CONNECTING = "QB_CONNECTING"
QB_STATUS_READY      = "QB_READY"
QB_STATUS_WRONG_CO   = "QB_WRONG_CO"
QB_STATUS_BLOCKED    = "QB_BLOCKED"
QB_STATUS_DISABLED   = "QB_DISABLED"


@dataclass
class QBStartupStatus:
    status: str = QB_STATUS_DISABLED
    message: str = ""
    company_file: str = ""
    checked_at: str = ""
    error: str = ""
    # Extra detail for UI
    detail: str = ""

    def as_dict(self) -> dict:
        return {
            "status":       self.status,
            "message":      self.message,
            "company_file": self.company_file,
            "checked_at":   self.checked_at,
            "error":        self.error,
            "detail":       self.detail,
        }


@dataclass
class QBStartupConfig:
    auto_open_on_app_start: bool = True
    auto_connect_company_file: bool = True
    allow_company_switch: bool = False
    startup_timeout_seconds: int = 90
    exe_path: str = ""
    company_file: str = ""          # single-file override
    expected_company_name: str = ""
    password_key: str = "pass1"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


# ── Config loaders ────────────────────────────────────────────────────────────

def load_qb_startup_config(config: dict | None = None) -> QBStartupConfig:
    """Extract QB startup config from local-config dict."""
    if config is None:
        config = _load_local_config()
    qb_cfg = dict(config.get("quickbooks") or {})
    return QBStartupConfig(
        auto_open_on_app_start=bool(qb_cfg.get("auto_open_on_app_start", True)),
        auto_connect_company_file=bool(qb_cfg.get("auto_connect_company_file", True)),
        allow_company_switch=bool(qb_cfg.get("allow_company_switch", False)),
        startup_timeout_seconds=int(qb_cfg.get("startup_timeout_seconds") or 90),
        exe_path=str(qb_cfg.get("exe_path") or ""),
        company_file=str(qb_cfg.get("company_file") or ""),
        expected_company_name=str(qb_cfg.get("expected_company_name") or ""),
        password_key=str(qb_cfg.get("password_key") or "pass1"),
    )


def _load_local_config() -> dict:
    try:
        from app_paths import runtime_path
        cfg_path = runtime_path("local-config.json")
        if cfg_path.exists():
            return json.loads(cfg_path.read_text(encoding="utf-8-sig"))
    except Exception as exc:
        _log.warning("Could not load local-config.json: %s", exc)
    return {}


def _get_qbw_paths(config: dict | None = None) -> dict[str, str]:
    if config is None:
        config = _load_local_config()
    return dict(config.get("qbw_paths") or {})


# ── QB process detection ──────────────────────────────────────────────────────

_QB_PROCESS_NAMES = {
    "qbwenterprise.exe",
    "qbw32enterprise.exe",
    "qbw.exe",
}


def is_qb_running() -> bool:
    """Return True if any known QB process is running."""
    try:
        import psutil
        for proc in psutil.process_iter(["name"]):
            try:
                if proc.info["name"] and proc.info["name"].lower() in _QB_PROCESS_NAMES:
                    return True
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
    except ImportError:
        _log.warning("psutil not available — cannot check QB process status")
    return False


def get_qb_open_company_title() -> str:
    """
    Return the top-level QB window title (contains company name) if QB is open,
    or empty string if not found.
    """
    try:
        import psutil
        pids = []
        for proc in psutil.process_iter(["name", "pid"]):
            try:
                if proc.info["name"] and proc.info["name"].lower() in _QB_PROCESS_NAMES:
                    pids.append(proc.info["pid"])
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        if not pids:
            return ""
        # Try pywinauto to get window title
        try:
            from pywinauto import Desktop
            desktop = Desktop(backend="uia")
            for win in desktop.windows():
                try:
                    title = win.window_text()
                    if title and "QuickBooks" in title and "Login" not in title:
                        return title
                except Exception:
                    pass
        except ImportError:
            pass
    except ImportError:
        pass
    return ""


def has_qb_login_dialog() -> bool:
    """Return True when the QuickBooks login dialog is visible."""
    try:
        from pywinauto import Desktop

        desktop = Desktop(backend="uia")
        for win in desktop.windows():
            try:
                if win.window_text() == "QuickBooks Desktop Login":
                    return True
                for child in win.children():
                    if child.window_text() == "QuickBooks Desktop Login":
                        return True
            except Exception:
                pass
    except Exception:
        pass
    return False


def _password_configured(password_key: str) -> bool:
    try:
        import qb_automate

        return bool((getattr(qb_automate, "PASSWORDS", {}) or {}).get(password_key or "pass1"))
    except Exception:
        return False


def _company_name_in_title(title: str, company_file: str, expected_company_name: str = "") -> bool:
    """Check if the expected company or file stem appears in the QB window title."""
    if not title or not company_file:
        return True  # cannot verify — assume ok
    def clean(value: str) -> str:
        return "".join(ch.lower() for ch in str(value or "") if ch.isalnum())

    title_clean = clean(title)
    generic_titles = {
        "intuitquickbooks",
        "quickbooks",
        "quickbooksdesktop",
        "quickbooksenterprisesolutions",
        "intuitquickbooksenterprisesolutions",
        "intuitquickbooksenterprisesolutions240",
    }
    if title_clean in generic_titles:
        return True  # generic shell title; cannot prove the company is wrong

    candidates = [Path(company_file).stem, expected_company_name]
    return any(clean(candidate) in title_clean for candidate in candidates if candidate)


# ── Core startup logic ────────────────────────────────────────────────────────

class QBStartupService:
    """
    Non-blocking QB startup service.

    Usage (from App.__init__ after UI is ready):
        service = QBStartupService(on_status=self._on_qb_status_changed)
        service.run_in_background()
    """

    def __init__(
        self,
        *,
        config: dict | None = None,
        on_status: Optional[Callable[[QBStartupStatus], None]] = None,
        on_log: Optional[Callable[[str], None]] = None,
    ):
        self._raw_config = config  # will be loaded lazily if None
        self._on_status = on_status
        self._on_log = on_log
        self._status = QBStartupStatus(
            status=QB_STATUS_DISABLED,
            message="QB startup service not yet started.",
            checked_at=_utc_now_iso(),
        )
        self._lock = threading.Lock()

    # ── Public ────────────────────────────────────────────────────────────────

    def run_in_background(self) -> None:
        """Kick off the startup check in a daemon thread — does not block the UI."""
        t = threading.Thread(target=self._run, daemon=True, name="qb-startup-svc")
        t.start()

    def get_status(self) -> QBStartupStatus:
        with self._lock:
            return self._status

    def run_now(self) -> QBStartupStatus:
        """Synchronous run — for testing or manual trigger. Blocks caller."""
        self._run()
        return self.get_status()

    # ── Internal ──────────────────────────────────────────────────────────────

    def _emit(self, msg: str) -> None:
        _log.info("[QBStartup] %s", msg)
        if callable(self._on_log):
            try:
                self._on_log(msg)
            except Exception:
                pass

    def _set_status(self, status: str, message: str, *, error: str = "", company_file: str = "", detail: str = "") -> None:
        with self._lock:
            self._status = QBStartupStatus(
                status=status,
                message=message,
                company_file=company_file,
                checked_at=_utc_now_iso(),
                error=error,
                detail=detail,
            )
        self._emit(f"[{status}] {message}" + (f" — {error}" if error else ""))
        self._log_activity(status, message, error=error)
        if callable(self._on_status):
            try:
                self._on_status(self._status)
            except Exception as exc:
                _log.warning("on_status callback error: %s", exc)

    def _log_activity(self, status: str, message: str, error: str = "") -> None:
        try:
            from services.activity_log_service import log as activity_log, EventCategory, EventSeverity
            severity = EventSeverity.ERROR if error else EventSeverity.INFO
            activity_log(
                EventCategory.QB_SYNC,
                f"QB Startup: {message}",
                detail=f"status={status}" + (f" error={error}" if error else ""),
                success=status == QB_STATUS_READY,
                severity=severity,
            )
        except Exception:
            pass  # Activity log is best-effort

    def _run(self) -> None:
        """Main startup logic. Runs in background thread."""
        try:
            local_config = self._raw_config or _load_local_config()
            cfg = load_qb_startup_config(local_config)

            # ── Disabled guard ────────────────────────────────────────────
            if not cfg.auto_open_on_app_start:
                self._set_status(QB_STATUS_DISABLED, "QB auto-open is disabled in config.")
                return

            # ── Resolve company file ──────────────────────────────────────
            company_file = self._resolve_company_file(cfg, local_config)
            if not company_file:
                self._set_status(
                    QB_STATUS_BLOCKED,
                    "No QB company file configured.",
                    error="Set 'quickbooks.company_file' or 'qbw_paths' in local-config.json.",
                )
                return

            # ── Validate company file path ───────────────────────────────
            if not Path(company_file).exists():
                self._set_status(
                    QB_STATUS_BLOCKED,
                    f"QB company file not found: {Path(company_file).name}",
                    error=f"Path does not exist: {company_file}",
                    company_file=company_file,
                )
                return

            # ── Resolve QB executable ────────────────────────────────────
            try:
                _resolve = resolve_qb_executable  # module-level name (patchable)
                if _resolve is None:
                    raise ImportError("qb_automate not available")
                qb_exe = _resolve()
                if cfg.exe_path:
                    qb_exe = Path(cfg.exe_path) if Path(cfg.exe_path).exists() else qb_exe
            except Exception as exc:
                self._set_status(
                    QB_STATUS_BLOCKED,
                    "QB executable discovery failed.",
                    error=str(exc),
                )
                return

            if not qb_exe or not qb_exe.exists():
                self._set_status(
                    QB_STATUS_BLOCKED,
                    "QuickBooks Desktop executable not found.",
                    error="Install QuickBooks or set 'quickbooks.exe_path' in local-config.json.",
                )
                return

            # ── Check if QB is already running ───────────────────────────
            if is_qb_running():
                self._emit("QB is already running — checking company title...")
                title = get_qb_open_company_title()
                if has_qb_login_dialog():
                    if _password_configured(cfg.password_key):
                        self._emit("QB login dialog is open. Attempting configured auto-login...")
                        self._open_and_connect(cfg, company_file, qb_exe)
                    else:
                        self._set_status(
                            QB_STATUS_BLOCKED,
                            "QB login dialog is open.",
                            error=(
                                "Enter the QuickBooks password, or configure "
                                f"QB_PASSWORD for password_key '{cfg.password_key}'."
                            ),
                            company_file=company_file,
                            detail=title or "QuickBooks Desktop Login",
                        )
                    return
                if title and not _company_name_in_title(title, company_file, cfg.expected_company_name):
                    if cfg.allow_company_switch:
                        self._emit("Wrong company open. Config allows switch — attempting re-open...")
                        self._set_status(
                            QB_STATUS_CONNECTING,
                            "QB open with wrong company — switching...",
                            company_file=company_file,
                        )
                        self._open_and_connect(cfg, company_file, qb_exe)
                    else:
                        self._set_status(
                            QB_STATUS_WRONG_CO,
                            f"QB is open with a different company.",
                            error=f"Open company: '{title}'. Expected: '{Path(company_file).name}'. Set 'allow_company_switch=true' to auto-switch.",
                            company_file=company_file,
                            detail=title,
                        )
                else:
                    self._set_status(
                        QB_STATUS_READY,
                        f"QB is already open: {Path(company_file).name}",
                        company_file=company_file,
                        detail=title or "",
                    )
                return

            # ── QB not running — launch ────────────────────────────────
            if not cfg.auto_connect_company_file:
                self._set_status(
                    QB_STATUS_CLOSED,
                    "QB is not running. Auto-connect is disabled.",
                    company_file=company_file,
                )
                return

            self._set_status(
                QB_STATUS_OPENING,
                f"Launching QuickBooks Desktop...",
                company_file=company_file,
            )
            self._open_and_connect(cfg, company_file, qb_exe)

        except Exception as exc:
            _log.exception("QBStartupService._run unexpected error")
            self._set_status(QB_STATUS_BLOCKED, "Unexpected error during QB startup.", error=str(exc))

    def _open_and_connect(self, cfg: QBStartupConfig, company_file: str, qb_exe: Path) -> None:
        """Launch QB and wait for it to be ready. Updates status throughout."""
        try:
            _open = open_qb_with_file  # module-level name (patchable)
            if _open is None:
                raise ImportError("qb_automate not available")

            self._set_status(
                QB_STATUS_OPENING,
                f"Opening QB: {Path(company_file).name}",
                company_file=company_file,
            )

            success = _open(
                qbw_path=company_file,
                password_key=cfg.password_key,
                callback=self._emit,
            )

            if success:
                title = get_qb_open_company_title()
                self._set_status(
                    QB_STATUS_READY,
                    f"QB is ready: {Path(company_file).name}",
                    company_file=company_file,
                    detail=title or "",
                )
            else:
                self._set_status(
                    QB_STATUS_BLOCKED,
                    "QB failed to open or authenticate.",
                    error="open_qb_with_file returned False. Check QB exe path, company file, and password.",
                    company_file=company_file,
                )
        except Exception as exc:
            _log.exception("_open_and_connect error")
            self._set_status(
                QB_STATUS_BLOCKED,
                "Error while opening QB.",
                error=str(exc),
                company_file=company_file,
            )

    def _resolve_company_file(self, cfg: QBStartupConfig, local_config: dict) -> str:
        """
        Priority:
          1. cfg.company_file (quickbooks.company_file in local-config)
          2. First entry in qbw_paths
        """
        if cfg.company_file:
            return cfg.company_file
        qbw_paths = _get_qbw_paths(local_config)
        if qbw_paths:
            return next(iter(qbw_paths.values()))
        return ""


# ── Module-level singleton helpers ────────────────────────────────────────────

_service_instance: QBStartupService | None = None


def get_qb_startup_service() -> QBStartupService | None:
    """Return the current module-level service instance (if started)."""
    return _service_instance


def start_qb_startup_service(
    *,
    config: dict | None = None,
    on_status: Optional[Callable[[QBStartupStatus], None]] = None,
    on_log: Optional[Callable[[str], None]] = None,
) -> QBStartupService:
    """
    Create and start the QB startup service in a background thread.
    Call this once from App after UI is ready.

    Returns the service instance so callers can query status later.
    """
    global _service_instance
    _service_instance = QBStartupService(config=config, on_status=on_status, on_log=on_log)
    _service_instance.run_in_background()
    return _service_instance
