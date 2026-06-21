"""Human handoff state for Toast browser automation blockers."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from app_paths import runtime_path
except ImportError:
    def runtime_path(*parts: str) -> Path:
        return Path("runtime").joinpath(*parts)

from services.toast_browser_agent import STATUS_HUMAN_REQUIRED


HANDOFF_FILE = runtime_path("runtime", "toast-human-handoff.json")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_handoff(
    *,
    reason: str,
    store: str = "",
    business_date: str = "",
    report_type: str = "",
    screenshot_path: str = "",
) -> dict[str, Any]:
    HANDOFF_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "status": STATUS_HUMAN_REQUIRED,
        "reason": reason,
        "store": store,
        "business_date": business_date,
        "report_type": report_type,
        "screenshot_path": screenshot_path,
        "created_at": utc_now_iso(),
        "operator_confirmed_at": "",
    }
    HANDOFF_FILE.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return payload


def mark_login_completed() -> dict[str, Any]:
    payload: dict[str, Any] = {}
    if HANDOFF_FILE.exists():
        try:
            payload = json.loads(HANDOFF_FILE.read_text(encoding="utf-8-sig"))
        except Exception:
            payload = {}
    payload["status"] = "LOGIN_COMPLETED"
    payload["operator_confirmed_at"] = utc_now_iso()
    HANDOFF_FILE.parent.mkdir(parents=True, exist_ok=True)
    HANDOFF_FILE.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return payload


def get_handoff_state() -> dict[str, Any]:
    if not HANDOFF_FILE.exists():
        return {}
    try:
        return json.loads(HANDOFF_FILE.read_text(encoding="utf-8-sig"))
    except Exception:
        return {}
