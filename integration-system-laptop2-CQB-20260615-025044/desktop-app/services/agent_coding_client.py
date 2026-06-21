"""
agent_coding_client.py
=======================
HTTP client that sends heartbeats, events, activity-log results, timeline
results, sync results, and errors to the Agent-Coding server.

Designed to run in the QB Background Agent (ToastPOSManager.exe --background).
Uses machine_identity_service.py to get machine_id, headers, and base URL.

If Agent-Coding is unreachable, events are queued in reporting_outbox.py.
"""
from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Optional
from threading import Lock

from services.machine_identity_service import (
    get_machine_identity,
    get_agent_coding_config,
    get_base_url,
    get_api_key,
)

from services.reporting_outbox import get_outbox

logger = logging.getLogger("agent_coding_client")

# Module-level singleton
_instance_lock = Lock()
_client: Optional["AgentCodingClient"] = None


def get_client() -> "AgentCodingClient":
    """Return the singleton AgentCodingClient instance."""
    global _client
    with _instance_lock:
        if _client is None:
            _client = AgentCodingClient()
        return _client


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AgentCodingClient:
    """
    Thin HTTP client for Agent-Coding server communication.

    All requests include:
        Authorization: Bearer <AGENT_CODING_API_KEY>
        X-Machine-ID: <machine_id>
        X-Agent-Version: <app_version>
        Content-Type: application/json

    Methods return True on success, False on failure.
    Failures are silent (logged) and the caller should push to outbox.
    """

    def __init__(self, base_url: Optional[str] = None, timeout: Optional[int] = None):
        self._base_url = (base_url or get_base_url()).rstrip("/")
        cfg = get_agent_coding_config()
        self._timeout = timeout or cfg.get("timeout_seconds", 15)
        self._api_key = get_api_key()
        self._identity = get_machine_identity()

    @property
    def identity(self):
        return self._identity

    # ── Request helpers ────────────────────────────────────────────────────

    def _headers(self, extra: Optional[dict] = None) -> dict:
        h = {
            "Authorization": f"Bearer {self._api_key}",
            "X-API-Key": self._api_key,
            "X-Machine-ID": self._identity.machine_id,
            "X-Agent-Version": self._identity.app_version,
            "Content-Type": "application/json",
        }
        if extra:
            h.update(extra)
        return h

    def _post(self, path: str, payload: dict, retry_count: int = 1) -> bool:
        url = f"{self._base_url}{path}"
        body = json.dumps(payload).encode("utf-8")
        last_err: Optional[Exception] = None
        for attempt in range(retry_count):
            try:
                req = urllib.request.Request(
                    url,
                    data=body,
                    headers=self._headers(),
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                    if 200 <= resp.status < 300:
                        return True
                    logger.warning("[AgentCoding] %s returned HTTP %s", url, resp.status)
            except urllib.error.URLError as exc:
                last_err = exc
                logger.warning("[AgentCoding] %s failed (attempt %s): %s", url, attempt + 1, exc)
            except Exception as exc:
                last_err = exc
                logger.warning("[AgentCoding] %s failed: %s", url, exc)
            if attempt < retry_count - 1:
                time.sleep(1)
        # All attempts failed — queue to outbox
        self._enqueue_outbox(path, payload, str(last_err))
        return False

    def _enqueue_outbox(self, path: str, payload: dict, error: str) -> None:
        outbox = get_outbox()
        outbox.enqueue({
            "method": "POST",
            "path": path,
            "payload": payload,
            "error": error,
            "attempted_at": _utc_now(),
        })

    # ── Ping ────────────────────────────────────────────────────────────────

    def ping(self) -> bool:
        """GET /api/qb-agent/ping — no auth required for health check."""
        url = f"{self._base_url}/api/qb-agent/ping"
        try:
            req = urllib.request.Request(url, headers={}, method="GET")
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                return 200 <= resp.status < 300
        except Exception as exc:
            logger.debug("[AgentCoding] ping failed: %s", exc)
            return False

    # ── Registration ───────────────────────────────────────────────────────

    def register(self) -> bool:
        """
        POST /api/qb-agent/register
        Register this machine with Agent-Coding. Should be called once on startup.
        """
        from services.machine_identity_service import get_register_payload
        payload = get_register_payload()
        payload["registered_at"] = _utc_now()
        return self._post("/api/qb-agent/register", payload)

    # ── Heartbeat ──────────────────────────────────────────────────────────

    def heartbeat(
        self,
        qb_status: str = "unknown",
        agent_status: str = "running",
        activity_log_status: str = "idle",
        timeline_status: str = "idle",
        auto_sync_status: str = "idle",
        last_error: Optional[str] = None,
        extra: Optional[dict] = None,
    ) -> bool:
        """
        POST /api/qb-agent/heartbeat
        Called every N seconds (configurable, default 60s).
        """
        payload = {
            "machine_id": self._identity.machine_id,
            "store_code": self._identity.store_code,
            "qb_status": qb_status,
            "agent_status": agent_status,
            "activity_log_status": activity_log_status,
            "timeline_status": timeline_status,
            "auto_sync_status": auto_sync_status,
            "last_error": last_error,
            "payload_json": json.dumps(extra or {}),
            "heartbeat_at": _utc_now(),
        }
        return self._post("/api/qb-agent/heartbeat", payload)

    # ── Generic event ───────────────────────────────────────────────────────

    def event(
        self,
        event_type: str,
        status: Optional[str] = None,
        payload: Optional[dict] = None,
    ) -> bool:
        """
        POST /api/qb-agent/event
        event_type examples: BACKGROUND_AGENT_STARTED, QB_READY, REMOTE_COMMAND_RECEIVED
        """
        payload_out = {
            "event_id": f"{self._identity.machine_id}-{event_type}-{int(time.time())}",
            "machine_id": self._identity.machine_id,
            "store_code": self._identity.store_code,
            "event_type": event_type,
            "status": status or "info",
            "payload_json": json.dumps(payload or {}),
            "created_at": _utc_now(),
            "received_at": _utc_now(),
        }
        return self._post("/api/qb-agent/event", payload_out)

    # ── Activity Log Result ─────────────────────────────────────────────────

    def activity_log_result(
        self,
        business_date: str,
        status: str,
        latest_sales_receipt_date: Optional[str] = None,
        latest_sales_receipt_ref: Optional[str] = None,
        latest_sales_receipt_amount: Optional[float] = None,
        latest_bank_transaction_date: Optional[str] = None,
        latest_reconcile_date: Optional[str] = None,
        local_json_path: Optional[str] = None,
        local_markdown_path: Optional[str] = None,
        metrics: Optional[dict] = None,
        warnings: Optional[list] = None,
        errors: Optional[list] = None,
        duration_ms: Optional[int] = None,
    ) -> bool:
        """
        POST /api/qb-agent/activity-log-result
        Sent after generating an activity log for a business date.
        """
        pl = {
            "machine_id": self._identity.machine_id,
            "store_code": self._identity.store_code,
            "business_date": business_date,
            "status": status,
            "latest_sales_receipt_date": latest_sales_receipt_date,
            "latest_sales_receipt_ref": latest_sales_receipt_ref,
            "latest_sales_receipt_amount": latest_sales_receipt_amount,
            "latest_bank_transaction_date": latest_bank_transaction_date,
            "latest_reconcile_date": latest_reconcile_date,
            "local_json_path": local_json_path,
            "local_markdown_path": local_markdown_path,
            "metrics_json": json.dumps(metrics or {}),
            "warnings_json": json.dumps(warnings or []),
            "errors_json": json.dumps(errors or []),
            "duration_ms": duration_ms,
            "generated_at": _utc_now(),
            "received_at": _utc_now(),
        }
        return self._post("/api/qb-agent/activity-log-result", pl)

    # ── Timeline Result ─────────────────────────────────────────────────────

    def timeline_result(
        self,
        business_date: str,
        events: Optional[list[dict]] = None,
    ) -> bool:
        """
        POST /api/qb-agent/timeline-result
        events: list of event dicts with keys: event_key, event_time, event_type,
                action, ref_number, amount, account, customer, class_name, source
        """
        pl = {
            "machine_id": self._identity.machine_id,
            "store_code": self._identity.store_code,
            "business_date": business_date,
            "events": events or [],
            "generated_at": _utc_now(),
            "received_at": _utc_now(),
        }
        return self._post("/api/qb-agent/timeline-result", pl)

    # ── Sync Result ──────────────────────────────────────────────────────────

    def sync_result(
        self,
        business_date: str,
        status: str,
        transactions_synced: int = 0,
        errors: Optional[list] = None,
        result_json: Optional[dict] = None,
    ) -> bool:
        """
        POST /api/qb-agent/sync-result
        Sent after an auto-sync run completes.
        """
        pl = {
            "machine_id": self._identity.machine_id,
            "store_code": self._identity.store_code,
            "business_date": business_date,
            "status": status,
            "transactions_synced": transactions_synced,
            "errors_json": json.dumps(errors or []),
            "result_json": json.dumps(result_json or {}),
            "generated_at": _utc_now(),
            "received_at": _utc_now(),
        }
        return self._post("/api/qb-agent/sync-result", pl)

    # ── Error Report ────────────────────────────────────────────────────────

    def error_report(
        self,
        severity: str,
        component: str,
        message: str,
        exception: Optional[str] = None,
        context: Optional[dict] = None,
    ) -> bool:
        """
        POST /api/qb-agent/error
        Reports errors from the QB Agent to Agent-Coding.
        """
        pl = {
            "machine_id": self._identity.machine_id,
            "store_code": self._identity.store_code,
            "severity": severity,
            "component": component,
            "message": message,
            "exception": exception,
            "context_json": json.dumps(context or {}),
            "occurred_at": _utc_now(),
        }
        return self._post("/api/qb-agent/error", pl)

    # ── Refresh config ───────────────────────────────────────────────────────

    def refresh_config(self) -> None:
        """Reload base URL and timeout from config (useful after config change)."""
        cfg = get_agent_coding_config()
        self._base_url = cfg.get("base_url", "http://localhost:3456").rstrip("/")
        self._timeout = cfg.get("timeout_seconds", 15)
        self._api_key = get_api_key()
        self._identity = get_machine_identity()
