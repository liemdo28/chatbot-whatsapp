"""Safety and task construction for optional Browser-Use Toast automation."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


AUTOMATION_PLAYWRIGHT_STATIC = "PLAYWRIGHT_STATIC"
AUTOMATION_BROWSER_USE_AGENT = "BROWSER_USE_AGENT"
AUTOMATION_HYBRID_FALLBACK = "HYBRID_FALLBACK"

STATUS_DOWNLOAD_STARTED = "DOWNLOAD_STARTED"
STATUS_PLAYWRIGHT_RUNNING = "PLAYWRIGHT_RUNNING"
STATUS_PLAYWRIGHT_FAILED = "PLAYWRIGHT_FAILED"
STATUS_BROWSER_USE_RUNNING = "BROWSER_USE_RUNNING"
STATUS_BROWSER_USE_FAILED = "BROWSER_USE_FAILED"
STATUS_HUMAN_REQUIRED = "HUMAN_REQUIRED"
STATUS_DOWNLOAD_COMPLETED = "DOWNLOAD_COMPLETED"
STATUS_REPORT_VALIDATED = "REPORT_VALIDATED"
STATUS_REPORT_INVALID = "REPORT_INVALID"

ALLOWED_ACTIONS = {
    "navigate",
    "click_report_menu",
    "set_date_filter",
    "select_store",
    "download_report",
    "take_screenshot",
    "return_status",
}

FORBIDDEN_TERMS = (
    "change setting",
    "settings change",
    "delete",
    "modify menu",
    "menu item",
    "payroll",
    "payment settings",
    "submit payment",
    "store password",
    "save password",
    "bypass mfa",
    "bypass captcha",
    "solve captcha",
)

DEFAULT_TOAST_DOWNLOAD_CONFIG: dict[str, Any] = {
    "enabled": True,
    "automation_mode": AUTOMATION_HYBRID_FALLBACK,
    "download_dir": r"C:\ProgramData\ToastPOSManager\toast-reports",
    "allowed_domains": ["*.toasttab.com", "*.toasttab.com/*"],
    "browser_profile": {
        "use_real_profile": True,
        "browser": "chrome",
        "profile_path": "",
        "require_existing_login": True,
    },
    "browser_use": {
        "enabled": True,
        "model_provider": "openai",
        "model": "gpt-5.5",
        "timeout_seconds": 180,
        "max_steps": 40,
        "headless": False,
        "human_approval_required_for_login": True,
        "never_store_password": True,
    },
}


@dataclass(frozen=True)
class ToastBrowserTask:
    store: str
    business_date: str
    report_type: str
    download_dir: Path


def merge_toast_download_config(config: dict | None) -> dict:
    """Return config with safe defaults and no shared nested mutation."""
    source = dict(config or {})
    toast_cfg = dict(DEFAULT_TOAST_DOWNLOAD_CONFIG)
    user_toast = dict(source.get("toast_download") or source)

    for key, value in user_toast.items():
        if isinstance(value, dict) and isinstance(toast_cfg.get(key), dict):
            nested = dict(toast_cfg[key])
            nested.update(value)
            toast_cfg[key] = nested
        else:
            toast_cfg[key] = value
    return toast_cfg


def is_browser_use_enabled(config: dict | None) -> bool:
    cfg = merge_toast_download_config(config)
    browser_use = dict(cfg.get("browser_use") or {})
    return bool(cfg.get("enabled", True) and browser_use.get("enabled", True))


def normalize_automation_mode(value: str | None) -> str:
    mode = str(value or AUTOMATION_HYBRID_FALLBACK).strip().upper()
    if mode not in {AUTOMATION_PLAYWRIGHT_STATIC, AUTOMATION_BROWSER_USE_AGENT, AUTOMATION_HYBRID_FALLBACK}:
        return AUTOMATION_HYBRID_FALLBACK
    return mode


def build_browser_use_task(task: ToastBrowserTask, config: dict | None = None) -> str:
    cfg = merge_toast_download_config(config)
    allowed_domains = ", ".join(cfg.get("allowed_domains") or ["*.toasttab.com"])
    return (
        "Open ToastTab dashboard using the existing logged-in browser profile.\n"
        f"Allowed domains: {allowed_domains}.\n"
        "Navigate to Reports.\n"
        f"Download the {task.report_type} report for store '{task.store}' and business date {task.business_date}.\n"
        f"Save the downloaded file to: {task.download_dir}.\n"
        "Do not change settings. Do not submit forms except report filters.\n"
        "Do not modify store data, menu items, payroll, payments, or account settings.\n"
        "Do not store passwords and do not bypass MFA or CAPTCHA.\n"
        "If login, 2FA, CAPTCHA, permission error, or unclear UI appears, stop and return HUMAN_REQUIRED.\n"
        "Allowed actions only: navigate, click report menu, set date filter, select store, download CSV/XLSX/PDF, "
        "take screenshot, return status."
    )


def assert_task_is_safe(task_text: str) -> None:
    lowered = str(task_text or "").lower()
    for forbidden in FORBIDDEN_TERMS:
        idx = lowered.find(forbidden)
        if idx < 0:
            continue
        prefix = lowered[max(0, idx - 48):idx]
        if "do not" not in prefix and "never" not in prefix and "forbidden" not in prefix:
            raise ValueError(f"Forbidden browser action detected: {forbidden}")


def classify_browser_blocker(message: str) -> str:
    text = str(message or "").lower()
    human_terms = ("login", "sign in", "mfa", "2fa", "captcha", "permission", "access denied")
    if any(term in text for term in human_terms):
        return STATUS_HUMAN_REQUIRED
    return STATUS_BROWSER_USE_FAILED
