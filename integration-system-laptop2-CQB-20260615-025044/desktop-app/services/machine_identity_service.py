"""
machine_identity_service.py
============================
Provides machine identity for this QB Agent PC.
Reads from local-config.json (generated from local-config.example.json).

Usage:
    identity = get_machine_identity()
    # -> {"machine_id": "qb-pc-bandera-01", "store_code": "bandera", ...}
"""
from __future__ import annotations

import json
import os
import platform
import uuid
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from json_file_utils import load_json_file

# Use same path resolution as app_paths.py
try:
    from app_paths import RUNTIME_DIR
except ImportError:
    RUNTIME_DIR = Path(__file__).resolve().parent.parent

LOCAL_CONFIG_PATH = RUNTIME_DIR / "local-config.json"

# Env vars for Mi-Core. AGENT_CODING_API_KEY remains supported for older installs.
MI_CORE_URL_ENV = "MI_CORE_URL"
MI_CORE_API_KEY_ENV = "MI_CORE_API_KEY"
AGENT_CODING_API_KEY_ENV = "AGENT_CODING_API_KEY"


@dataclass
class MachineIdentity:
    machine_id: str
    machine_name: str
    store_code: str
    store_name: str
    location: str
    app_version: str
    os_version: str
    hostname: str
    is_configured: bool

    def to_dict(self) -> dict:
        return asdict(self)

    def to_headers(self) -> dict:
        api_key = get_api_key()
        return {
            "X-Machine-ID": self.machine_id,
            "X-Agent-Version": self.app_version,
            "X-API-Key": api_key,
            "Authorization": f"Bearer {api_key}",
        }


def _load_local_config() -> dict:
    if LOCAL_CONFIG_PATH.exists():
        try:
            return load_json_file(LOCAL_CONFIG_PATH)
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def get_api_key() -> str:
    config = _load_local_config()
    central_section = config.get("mi_core") or config.get("agent_coding", {})
    configured_key_env = central_section.get("api_key_env") or MI_CORE_API_KEY_ENV
    return (
        os.environ.get(MI_CORE_API_KEY_ENV)
        or os.environ.get(configured_key_env)
        or os.environ.get(AGENT_CODING_API_KEY_ENV)
        or ""
    )


def get_machine_identity() -> MachineIdentity:
    """Return machine identity from local-config.json."""
    config = _load_local_config()

    # Central control section. "mi_core" is canonical; "agent_coding" is legacy.
    central_section = config.get("mi_core") or config.get("agent_coding", {})

    machine_section = config.get("machine", {})

    # Fallbacks
    machine_id = machine_section.get("machine_id", "") or central_section.get("machine_id", "")
    store_code = machine_section.get("store_code", "")

    # Auto-generate if not set
    if not machine_id:
        hostname = platform.node()
        machine_id = f"auto-{hostname[:30]}"
        store_code = "unknown"

    hostname = platform.node()
    os_version = f"{platform.system()} {platform.release()}"

    # App version from version.json
    app_version = (
        str(central_section.get("app_version") or machine_section.get("app_version") or "")
        or "unknown"
    )
    version_path = RUNTIME_DIR / "version.json"
    if app_version == "unknown" and version_path.exists():
        try:
            vdata = load_json_file(version_path)
            app_version = vdata.get("app_version") or vdata.get("version") or "unknown"
        except Exception:
            pass

    return MachineIdentity(
        machine_id=machine_id,
        machine_name=machine_section.get("machine_name", hostname),
        store_code=store_code,
        store_name=machine_section.get("store_name", ""),
        location=machine_section.get("location", ""),
        app_version=app_version,
        os_version=os_version,
        hostname=hostname,
        is_configured=bool(machine_section.get("machine_id") and central_section.get("enabled")),
    )


def get_agent_coding_config() -> dict:
    """
    Return central control config.
    Prefers 'mi_core' key; falls back to 'agent_coding' for backward compatibility.
    """
    config = _load_local_config()
    defaults = {
        "enabled": False,
        "base_url": os.environ.get(MI_CORE_URL_ENV) or "http://localhost:4001",
        "api_key_env": MI_CORE_API_KEY_ENV,
        "app_version": "dev1-v2",
        "poll_commands_seconds": 60,
        "heartbeat_seconds": 60,
        "timeout_seconds": 15,
    }
    # Prefer mi_core, fall back to agent_coding
    user = config.get("mi_core") or config.get("agent_coding", {})
    result = defaults.copy()
    result.update(user)
    if os.environ.get(MI_CORE_URL_ENV):
        result["base_url"] = os.environ[MI_CORE_URL_ENV]
    return result


def get_central_config_source() -> str:
    """Return which config section provides central-control settings."""
    config = _load_local_config()
    if "mi_core" in config or os.environ.get(MI_CORE_URL_ENV):
        return "mi_core"
    if "agent_coding" in config:
        return "agent_coding"
    return "none"


def is_agent_coding_enabled() -> bool:
    cfg = get_agent_coding_config()
    return bool((cfg.get("enabled", False) or os.environ.get(MI_CORE_URL_ENV)) and get_api_key())


def get_base_url() -> str:
    return os.environ.get(MI_CORE_URL_ENV) or get_agent_coding_config().get("base_url", "http://localhost:4001")


def validate_identity() -> tuple[bool, str]:
    """Return (is_valid, error_message)."""
    identity = get_machine_identity()
    config = get_agent_coding_config()

    if not config.get("enabled"):
        return False, "agent_coding.enabled is False in local-config.json"

    if not get_api_key():
        key_env = config.get("api_key_env") or MI_CORE_API_KEY_ENV
        return False, f"Environment variable {key_env} is not set"

    if not identity.machine_id or identity.machine_id.startswith("auto-"):
        return False, "machine.machine_id not configured in local-config.json"

    return True, ""


def get_register_payload() -> dict:
    """Build the payload for POST /api/qb-agent/register."""
    identity = get_machine_identity()
    config = get_agent_coding_config()

    return {
        "machine_id": identity.machine_id,
        "machine_name": identity.machine_name,
        "store_code": identity.store_code,
        "store_name": identity.store_name,
        "location": identity.location,
        "app_version": identity.app_version,
        "os_version": identity.os_version,
        "hostname": identity.hostname,
        "base_url": config.get("base_url", ""),
        "capabilities": [
            "heartbeat",
            "event",
            "activity_log_result",
            "timeline_result",
            "sync_result",
            "error",
            "command_ack",
            "command_result",
            "command_complete",
        ],
        "registered_at": datetime.now(timezone.utc).isoformat(),
    }
