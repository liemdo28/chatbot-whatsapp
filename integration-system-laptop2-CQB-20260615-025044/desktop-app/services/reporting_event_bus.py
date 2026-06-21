"""
reporting_event_bus.py
=======================
Single-event emitter for QB Agent lifecycle events.

Every important event fires exactly once and is:
  1. Logged to runtime/logs/events.jsonl
  2. Sent to Agent-Coding via AgentCodingClient (or queued in outbox)

Usage:
    from reporting_event_bus import emit, EventType
    emit(EventType.BACKGROUND_AGENT_STARTED)
    emit(EventType.QB_READY, payload={"company_file": "...", "qb_status": "ready"})
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Optional
from threading import Lock

# Module-level RUNTIME_DIR for testability (patchable)
try:
    from app_paths import RUNTIME_DIR  # type: ignore
except ImportError:
    RUNTIME_DIR = Path(__file__).resolve().parent.parent


def _get_event_log_path() -> Path:
    """Resolve event log path at call time so tests can patch RUNTIME_DIR."""
    return RUNTIME_DIR / "logs" / "events.jsonl"


EVENT_LOG = _get_event_log_path()

logger = logging.getLogger("reporting_event_bus")

# ── Event types ────────────────────────────────────────────────────────────────
class EventType(str, Enum):
    BACKGROUND_AGENT_STARTED    = "BACKGROUND_AGENT_STARTED"
    BACKGROUND_AGENT_HEARTBEAT  = "BACKGROUND_AGENT_HEARTBEAT"
    QB_OPEN_STARTED             = "QB_OPEN_STARTED"
    QB_READY                    = "QB_READY"
    QB_WRONG_COMPANY            = "QB_WRONG_COMPANY"
    QB_BLOCKED                  = "QB_BLOCKED"
    ACTIVITY_LOG_STARTED        = "ACTIVITY_LOG_STARTED"
    ACTIVITY_LOG_COMPLETED      = "ACTIVITY_LOG_COMPLETED"
    ACTIVITY_LOG_FAILED         = "ACTIVITY_LOG_FAILED"
    TIMELINE_STARTED            = "TIMELINE_STARTED"
    TIMELINE_COMPLETED          = "TIMELINE_COMPLETED"
    TIMELINE_FAILED            = "TIMELINE_FAILED"
    AUTO_SYNC_STARTED           = "AUTO_SYNC_STARTED"
    AUTO_SYNC_COMPLETED        = "AUTO_SYNC_COMPLETED"
    AUTO_SYNC_FAILED           = "AUTO_SYNC_FAILED"
    REMOTE_COMMAND_RECEIVED    = "REMOTE_COMMAND_RECEIVED"
    REMOTE_COMMAND_COMPLETED   = "REMOTE_COMMAND_COMPLETED"
    REMOTE_COMMAND_FAILED      = "REMOTE_COMMAND_FAILED"


# ── Singleton state ───────────────────────────────────────────────────────────
_lock = Lock()
_instance: Optional["ReportingEventBus"] = None


def get_bus() -> "ReportingEventBus":
    global _instance
    with _lock:
        if _instance is None:
            _instance = ReportingEventBus()
        return _instance


def get_outbox():
    """Module-level alias for outbox access (patchable in tests)."""
    from services.reporting_outbox import get_outbox as _go
    return _go()


def emit(
    event_type: EventType,
    status: Optional[str] = None,
    payload: Optional[dict] = None,
) -> None:
    """Fire an event through the global bus."""
    get_bus().emit(event_type, status=status, payload=payload)


def emit_many(
    events: list[tuple[EventType, Optional[str], Optional[dict]]]
) -> None:
    """Fire multiple events through the global bus."""
    get_bus().emit_many(events)


class ReportingEventBus:
    """
    Single-fire event bus for QB Agent events.

    Each event is:
      - Written to events.jsonl (append-only, newline-delimited JSON)
      - Posted to Agent-Coding /api/qb-agent/event (or queued in outbox)

    Deduplication: each event carries a unique event_id. If Agent-Coding
    receives a duplicate (same event_id), it should accept but not re-process.
    """

    # Severity mapping for common event types
    SEVERITY_MAP = {
        EventType.BACKGROUND_AGENT_STARTED:   "info",
        EventType.BACKGROUND_AGENT_HEARTBEAT: "debug",
        EventType.QB_OPEN_STARTED:            "info",
        EventType.QB_READY:                   "info",
        EventType.QB_WRONG_COMPANY:           "warning",
        EventType.QB_BLOCKED:                 "error",
        EventType.ACTIVITY_LOG_STARTED:       "info",
        EventType.ACTIVITY_LOG_COMPLETED:     "info",
        EventType.ACTIVITY_LOG_FAILED:       "error",
        EventType.TIMELINE_STARTED:           "info",
        EventType.TIMELINE_COMPLETED:        "info",
        EventType.TIMELINE_FAILED:           "error",
        EventType.AUTO_SYNC_STARTED:         "info",
        EventType.AUTO_SYNC_COMPLETED:       "info",
        EventType.AUTO_SYNC_FAILED:          "error",
        EventType.REMOTE_COMMAND_RECEIVED:    "info",
        EventType.REMOTE_COMMAND_COMPLETED:  "info",
        EventType.REMOTE_COMMAND_FAILED:     "error",
    }

    def __init__(
        self,
        event_log_path: Optional[Path] = None,
        client: Optional["AgentCodingClient"] = None,
    ):
        self._event_log = event_log_path or EVENT_LOG
        self._event_log.parent.mkdir(parents=True, exist_ok=True)
        self._client = client

    def _get_client(self):
        if self._client is None:
            try:
                from services.agent_coding_client import get_client
                self._client = get_client()
            except Exception as exc:
                logger.debug("Client not available: %s", exc)
        return self._client

    def _get_machine_info(self) -> tuple[str, str]:
        try:
            from services.machine_identity_service import get_machine_identity
            identity = get_machine_identity()
            return identity.machine_id, identity.store_code
        except Exception:
            return "unknown", "unknown"

    def _build_event(self, event_type: EventType, status, payload) -> dict:
        machine_id, store_code = self._get_machine_info()
        ts = datetime.now(timezone.utc)
        severity = self.SEVERITY_MAP.get(event_type, status or "info")
        return {
            "event_id": f"{machine_id}-{event_type.value}-{int(ts.timestamp())}",
            "machine_id": machine_id,
            "store_code": store_code,
            "event_type": event_type.value,
            "severity": severity,
            "status": status or severity,
            "payload_json": json.dumps(payload or {}),
            "created_at": ts.isoformat(),
            "received_at": ts.isoformat(),
        }

    def _write_jsonl(self, record: dict) -> None:
        try:
            with open(self._event_log, "a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
        except OSError as exc:
            logger.warning("[EventBus] failed to write event log: %s", exc)

    def emit(
        self,
        event_type: EventType,
        status: Optional[str] = None,
        payload: Optional[dict] = None,
    ) -> None:
        """
        Fire a single event.
        1. Write to events.jsonl
        2. POST to Agent-Coding (or queue in outbox)
        """
        record = self._build_event(event_type, status, payload)
        self._write_jsonl(record)

        client = self._get_client()
        if client is not None:
            ok = client._post("/api/qb-agent/event", record)
            if not ok:
                # Already handled by client._enqueue_outbox; just log
                logger.debug("[EventBus] event %s queued to outbox", event_type.value)
        else:
            # Client unavailable — push directly to outbox
            try:
                from services import reporting_outbox as _outbox_mod
                get_outbox = _outbox_mod.get_outbox
                outbox = get_outbox()
                outbox.enqueue({
                    "method": "POST",
                    "path": "/api/qb-agent/event",
                    "payload": record,
                    "attempted_at": datetime.now(timezone.utc).isoformat(),
                })
            except Exception as exc:
                logger.warning("[EventBus] could not enqueue to outbox: %s", exc)

        logger.info("[EventBus] %s (%s)", event_type.value, status or "info")

    def emit_many(
        self,
        events: list[tuple[EventType, Optional[str], Optional[dict]]]
    ) -> None:
        """Fire multiple events in order."""
        for event_type, status, payload in events:
            self.emit(event_type, status, payload)
