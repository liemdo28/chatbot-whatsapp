"""
mi_core_client.py
==================
Canonical HTTP client for Mi-core server (successor to agent_coding_client.py).

Supports both config keys:
  - "mi_core"       (preferred, new canonical name)
  - "agent_coding"  (legacy, still works with deprecation warning)

All callers should use get_client() to get the singleton.
"""
from __future__ import annotations

import json
import logging
import os
import warnings
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Optional
import urllib.error
import urllib.request
from json_file_utils import load_json_file

logger = logging.getLogger("mi_core_client")

try:
    from app_paths import RUNTIME_DIR
except ImportError:
    RUNTIME_DIR = Path(__file__).resolve().parent.parent

LOCAL_CONFIG_PATH = RUNTIME_DIR / "local-config.json"

MI_CORE_API_KEY_ENV = "MI_CORE_API_KEY"
MI_CORE_URL_ENV = "MI_CORE_URL"
AGENT_CODING_API_KEY_ENV = "AGENT_CODING_API_KEY"  # legacy

_instance_lock = Lock()
_client: Optional["MiCoreClient"] = None


def _load_local_config() -> dict:
    if LOCAL_CONFIG_PATH.exists():
        try:
            return load_json_file(LOCAL_CONFIG_PATH)
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def _get_central_config() -> tuple[dict, str]:
    """
    Returns (config_dict, source_key) where source_key is 'mi_core' or 'agent_coding'.
    Prefers 'mi_core' if present. Falls back to 'agent_coding' with a deprecation warning.
    """
    cfg = _load_local_config()
    if "mi_core" in cfg:
        return cfg["mi_core"], "mi_core"
    if "agent_coding" in cfg:
        warnings.warn(
            "Config key 'agent_coding' is deprecated. Rename to 'mi_core' in local-config.json.",
            DeprecationWarning,
            stacklevel=3,
        )
        logger.warning("Using deprecated config key 'agent_coding'. Rename to 'mi_core'.")
        return cfg["agent_coding"], "agent_coding"
    return {}, "none"


def get_central_config() -> dict:
    cfg, _ = _get_central_config()
    defaults = {
        "enabled": False,
        "base_url": os.environ.get(MI_CORE_URL_ENV) or "http://localhost:4001",
        "api_key_env": MI_CORE_API_KEY_ENV,
        "machine_id": "",
        "app_version": "dev1-v2",
        "poll_commands_seconds": 60,
        "heartbeat_seconds": 60,
        "timeout_seconds": 15,
    }
    defaults.update(cfg)
    if os.environ.get(MI_CORE_URL_ENV):
        defaults["base_url"] = os.environ[MI_CORE_URL_ENV]
    return defaults


def get_api_key() -> str:
    cfg = get_central_config()
    key_env = cfg.get("api_key_env", MI_CORE_API_KEY_ENV)
    # Try new env var, then legacy
    return (
        os.environ.get(MI_CORE_API_KEY_ENV)
        or os.environ.get(key_env)
        or os.environ.get(AGENT_CODING_API_KEY_ENV)
        or ""
    )


def get_base_url() -> str:
    return os.environ.get(MI_CORE_URL_ENV) or get_central_config().get("base_url", "http://localhost:4001")


def is_enabled() -> bool:
    cfg = get_central_config()
    return bool(cfg.get("enabled", False) or os.environ.get(MI_CORE_URL_ENV))


def get_client() -> "MiCoreClient":
    global _client
    with _instance_lock:
        if _client is None:
            _client = MiCoreClient()
        return _client


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class MiCoreClient:
    """
    HTTP client for Mi-core /api/qb-agent/* endpoints.
    Drop-in replacement for AgentCodingClient with new config key support.
    """

    def __init__(self, base_url: Optional[str] = None, timeout: Optional[int] = None):
        cfg = get_central_config()
        self._base_url = (base_url or cfg.get("base_url", "http://localhost:3456")).rstrip("/")
        self._timeout = timeout or cfg.get("timeout_seconds", 15)
        self._api_key = get_api_key()

    def _headers(self) -> dict:
        from services.machine_identity_service import get_machine_identity
        identity = get_machine_identity()
        headers = {
            "Content-Type": "application/json",
            "X-Machine-ID": identity.machine_id,
            "X-Agent-Version": identity.app_version,
        }
        if self._api_key:
            headers["X-API-Key"] = self._api_key
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    def _post(self, path: str, payload: dict) -> bool:
        url = f"{self._base_url}{path}"
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=self._headers(), method="POST")
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                return resp.status < 400
        except urllib.error.HTTPError as e:
            logger.warning("MiCore POST %s → HTTP %d", path, e.code)
        except Exception as e:
            logger.warning("MiCore POST %s failed: %s", path, e)
        return False

    def post(self, path: str, payload: dict) -> Optional[dict]:
        """POST JSON and return the decoded response body when available."""
        url = f"{self._base_url}{path}"
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=self._headers(), method="POST")
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                raw = resp.read().decode("utf-8")
                if not raw:
                    return {"ok": resp.status < 400}
                return json.loads(raw)
        except Exception as e:
            logger.warning("MiCore POST %s failed: %s", path, e)
            return None

    def _get(self, path: str, params: Optional[dict] = None) -> Optional[dict]:
        import urllib.parse
        url = f"{self._base_url}{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers=self._headers(), method="GET")
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            logger.warning("MiCore GET %s failed: %s", path, e)
        return None

    def get(self, path: str, params: Optional[dict] = None) -> Optional[dict]:
        """GET JSON from Mi-core."""
        return self._get(path, params=params)

    def ping(self) -> bool:
        result = self._get("/api/qb-agent/ping")
        return result is not None and result.get("ok", False)

    def register(self) -> bool:
        from services.machine_identity_service import get_register_payload
        return self._post("/api/qb-agent/register", get_register_payload())

    def heartbeat(self, status: str = "ok", qb_open: bool = False,
                  qb_company: str = "", uptime_seconds: int = 0) -> bool:
        from services.machine_identity_service import get_machine_identity
        identity = get_machine_identity()
        cfg = get_central_config()
        app_version = cfg.get("app_version") or identity.app_version
        return self._post("/api/qb-agent/heartbeat", {
            "machine_id": identity.machine_id,
            "store_code": identity.store_code,
            "status": status,
            "qb_open": qb_open,
            "qb_company": qb_company,
            "app_version": app_version,
        })

    def event(self, event_type: str, message: str, event_key: str = "",
              severity: str = "info", payload: Optional[dict] = None) -> bool:
        from services.machine_identity_service import get_machine_identity
        identity = get_machine_identity()
        return self._post("/api/qb-agent/event", {
            "machine_id": identity.machine_id,
            "store_code": identity.store_code,
            "event_type": event_type,
            "event_key": event_key,
            "message": message,
            "severity": severity,
            "occurred_at": _utc_now(),
            "payload": payload or {},
        })

    def activity_log_result(self, business_date: str, file_id: str = "",
                             total_transactions: int = 0, total_amount: float = 0.0,
                             metrics: Optional[dict] = None, warnings: Optional[list] = None,
                             errors: Optional[list] = None, duration_ms: int = 0,
                             **kwargs: Any) -> bool:
        from services.machine_identity_service import get_machine_identity
        identity = get_machine_identity()
        return self._post("/api/qb-agent/activity-log-result", {
            "machine_id": identity.machine_id,
            "store_code": identity.store_code,
            "file_id": file_id,
            "business_date": business_date,
            "total_transactions": total_transactions,
            "total_amount": total_amount,
            "metrics_json": json.dumps(metrics or {}),
            "warnings_json": json.dumps(warnings or []),
            "errors_json": json.dumps(errors or []),
            "duration_ms": duration_ms,
            "generated_at": _utc_now(),
            **kwargs,
        })

    def timeline_result(self, business_date: str, file_id: str = "",
                        events: Optional[list] = None) -> bool:
        from services.machine_identity_service import get_machine_identity
        identity = get_machine_identity()
        return self._post("/api/qb-agent/timeline-result", {
            "machine_id": identity.machine_id,
            "store_code": identity.store_code,
            "file_id": file_id,
            "business_date": business_date,
            "events": events or [],
            "generated_at": _utc_now(),
        })

    def sync_result(self, business_date: str, file_id: str = "", status: str = "PASS",
                    transactions_synced: int = 0, errors: Optional[list] = None,
                    result_json: Optional[dict] = None) -> bool:
        from services.machine_identity_service import get_machine_identity
        identity = get_machine_identity()
        return self._post("/api/qb-agent/sync-result", {
            "machine_id": identity.machine_id,
            "store_code": identity.store_code,
            "file_id": file_id,
            "business_date": business_date,
            "status": status,
            "transactions_synced": transactions_synced,
            "errors_json": json.dumps(errors or []),
            "result_json": json.dumps(result_json or {}),
            "generated_at": _utc_now(),
        })

    def error_report(self, severity: str, component: str, message: str,
                     exception: Optional[str] = None, context: Optional[dict] = None) -> bool:
        from services.machine_identity_service import get_machine_identity
        identity = get_machine_identity()
        return self._post("/api/qb-agent/error", {
            "machine_id": identity.machine_id,
            "store_code": identity.store_code,
            "severity": severity,
            "component": component,
            "message": message,
            "exception": exception,
            "context_json": json.dumps(context or {}),
            "occurred_at": _utc_now(),
        })

    def report_qb_files(self, files: list[dict]) -> bool:
        from services.machine_identity_service import get_machine_identity
        identity = get_machine_identity()
        return self._post("/api/qb-agent/qb-files", {
            "machine_id": identity.machine_id,
            "files": files,
        })

    def report_sync_cycle(self, cycle_id: str, started_at: str, finished_at: str,
                          total_files: int, pass_count: int, warning_count: int,
                          error_count: int, next_cycle_at: str) -> bool:
        from services.machine_identity_service import get_machine_identity
        identity = get_machine_identity()
        return self._post("/api/qb-agent/sync-cycle", {
            "machine_id": identity.machine_id,
            "cycle_id": cycle_id,
            "started_at": started_at,
            "finished_at": finished_at,
            "total_files": total_files,
            "pass_count": pass_count,
            "warning_count": warning_count,
            "error_count": error_count,
            "next_cycle_at": next_cycle_at,
        })

    def poll_commands(self) -> list[dict]:
        from services.machine_identity_service import get_machine_identity
        identity = get_machine_identity()
        result = self._get("/api/qb-agent/commands", {"machine_id": identity.machine_id})
        return result.get("commands", []) if result else []

    def ack_command(self, command_id: str) -> bool:
        return self._post(f"/api/qb-agent/commands/{command_id}/ack", {})

    def complete_command(self, command_id: str, status: str = "completed",
                         result: Optional[dict] = None, error: Optional[str] = None) -> bool:
        payload = {
            "status": status,
            "result_json": result or {},
        }
        if error:
            payload["error_message"] = error
        return self._post(f"/api/qb-agent/commands/{command_id}/complete", payload)

    def refresh_config(self) -> None:
        cfg = get_central_config()
        self._base_url = cfg.get("base_url", "http://localhost:3456").rstrip("/")
        self._timeout = cfg.get("timeout_seconds", 15)
        self._api_key = get_api_key()
