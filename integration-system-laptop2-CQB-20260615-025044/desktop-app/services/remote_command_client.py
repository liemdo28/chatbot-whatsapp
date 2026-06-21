"""
remote_command_client.py
=========================
Polls Agent-Coding for pending commands assigned to this machine,
acknowledges them, executes them, and posts results back.

Command types:
  OPEN_QB_NOW, TEST_QB_CONNECTION, GENERATE_ACTIVITY_LOG_NOW,
  GENERATE_TIMELINE_NOW, RUN_AUTO_SYNC_NOW, OPEN_LOG_FOLDER,
  RESTART_AGENT, STOP_AGENT, REFRESH_CONFIG, UPLOAD_LATEST_LOGS

Timeout per command (seconds):
  Default       = 600 (10 min)
  OPEN_QB_NOW   = 180 (3 min)
  *_LOG_*      = 300 (5 min)
"""
from __future__ import annotations

import json
import logging
import threading
import time
import urllib.parse
import urllib.error
import urllib.request
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Optional

from services.machine_identity_service import (
    get_machine_identity,
    get_agent_coding_config,
    get_base_url,
    get_api_key,
)

logger = logging.getLogger("remote_command_client")

# ── Command types & timeouts ──────────────────────────────────────────────────
class CommandType(str, Enum):
    OPEN_QB_NOW               = "OPEN_QB_NOW"
    TEST_QB_CONNECTION       = "TEST_QB_CONNECTION"
    GENERATE_ACTIVITY_LOG_NOW = "GENERATE_ACTIVITY_LOG_NOW"
    GENERATE_TIMELINE_NOW     = "GENERATE_TIMELINE_NOW"
    RUN_AUTO_SYNC_NOW        = "RUN_AUTO_SYNC_NOW"
    TRIGGER_SYNC             = "TRIGGER_SYNC"
    OPEN_LOG_FOLDER          = "OPEN_LOG_FOLDER"
    RESTART_AGENT            = "RESTART_AGENT"
    STOP_AGENT               = "STOP_AGENT"
    REFRESH_CONFIG           = "REFRESH_CONFIG"
    UPLOAD_LATEST_LOGS       = "UPLOAD_LATEST_LOGS"
    # Multi-file QB commands
    SCAN_QB_FILES            = "SCAN_QB_FILES"
    RUN_12H_SYNC_NOW         = "RUN_12H_SYNC_NOW"
    RUN_FILE_SYNC_NOW        = "RUN_FILE_SYNC_NOW"
    ENABLE_QB_FILE           = "ENABLE_QB_FILE"
    DISABLE_QB_FILE          = "DISABLE_QB_FILE"
    UPDATE_FILE_STORE_MAPPING = "UPDATE_FILE_STORE_MAPPING"
    OPEN_QB_FILE             = "OPEN_QB_FILE"
    TEST_QB_FILE_CONNECTION  = "TEST_QB_FILE_CONNECTION"

    @classmethod
    def from_str(cls, s: str) -> "CommandType":
        try:
            return cls(s)
        except ValueError:
            return cls.REFRESH_CONFIG  # fallback

    @property
    def timeout_seconds(self) -> int:
        table = {
            CommandType.OPEN_QB_NOW:               180,
            CommandType.GENERATE_ACTIVITY_LOG_NOW: 300,
            CommandType.GENERATE_TIMELINE_NOW:     300,
            CommandType.TRIGGER_SYNC:              3600,
        }
        return table.get(self, 600)


# ── Command status ─────────────────────────────────────────────────────────────
class CommandStatus(str, Enum):
    PENDING      = "PENDING"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    RUNNING     = "RUNNING"
    COMPLETED   = "COMPLETED"
    FAILED      = "FAILED"
    TIMEOUT     = "TIMEOUT"


# ── Command record ─────────────────────────────────────────────────────────────
@dataclass
class RemoteCommand:
    command_id:   str
    command_type: str
    payload:      dict = field(default_factory=dict)
    status:       str  = CommandStatus.PENDING.value
    created_at:   str  = ""
    started_at:   Optional[str] = None
    completed_at: Optional[str] = None
    result:       Optional[dict] = None
    error:        Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)


# ── Command executor ───────────────────────────────────────────────────────────
# Signature: (cmd: RemoteCommand, payload: dict) -> dict (result or error)
CommandExecutor = Callable[["RemoteCommand"], dict]


class NoOpExecutor:
    """Default executor — logs and returns success for all commands."""
    def __init__(self, on_command: Optional[Callable[[RemoteCommand], None]] = None):
        self._on_command = on_command

    def __call__(self, cmd: RemoteCommand) -> dict:
        logger.info("[NoOpExecutor] executing %s (%s)", cmd.command_type, cmd.command_id)
        if self._on_command:
            self._on_command(cmd)
        return {"ok": True, "command_id": cmd.command_id, "executed_by": "NoOpExecutor"}


# ── RemoteCommandClient ────────────────────────────────────────────────────────
class RemoteCommandClient:
    """
    Polls Agent-Coding for pending commands and executes them.

    Usage:
        client = RemoteCommandClient()
        client.register_command_handler(CommandType.OPEN_QB_NOW, my_open_qb_func)
        client.start()   # starts polling thread
        client.stop()    # stops polling
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        poll_seconds: Optional[int] = None,
        executor: Optional[CommandExecutor] = None,
    ):
        self._base_url = (base_url or get_base_url()).rstrip("/")
        cfg = get_agent_coding_config()
        self._poll_seconds = poll_seconds or cfg.get("poll_commands_seconds", 15)
        self._timeout = cfg.get("timeout_seconds", 15)
        self._api_key = get_api_key()
        self._identity = get_machine_identity()

        self._executor = executor or NoOpExecutor()
        self._handlers: dict[CommandType, CommandExecutor] = {}
        self._stop_event = threading.Event()
        self._poll_thread: Optional[threading.Thread] = None
        self._seen_ids: set[str] = set()   # deduplication

    # ── Handlers ─────────────────────────────────────────────────────────────

    def register_command_handler(
        self,
        command_type: CommandType,
        handler: CommandExecutor,
    ) -> None:
        self._handlers[command_type] = handler

    # ── HTTP helpers ──────────────────────────────────────────────────────────

    def _headers(self) -> dict:
        headers = {
            "X-Machine-ID": self._identity.machine_id,
            "X-Agent-Version": self._identity.app_version,
            "Content-Type": "application/json",
        }
        if self._api_key:
            headers["X-API-Key"] = self._api_key
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    def _get(self, path: str) -> Optional[dict]:
        url = f"{self._base_url}{path}"
        try:
            req = urllib.request.Request(url, headers=self._headers(), method="GET")
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                if 200 <= resp.status < 300:
                    return json.loads(resp.read().decode("utf-8"))
                logger.warning("[RemoteCmd] GET %s -> HTTP %s", url, resp.status)
        except Exception as exc:
            logger.debug("[RemoteCmd] GET %s failed: %s", url, exc)
        return None

    def _post(self, path: str, payload: dict) -> bool:
        url = f"{self._base_url}{path}"
        body = json.dumps(payload).encode("utf-8")
        try:
            req = urllib.request.Request(url, data=body, headers=self._headers(), method="POST")
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                return 200 <= resp.status < 300
        except Exception as exc:
            logger.debug("[RemoteCmd] POST %s failed: %s", url, exc)
            return False

    # ── Polling ───────────────────────────────────────────────────────────────

    def poll(self) -> list[RemoteCommand]:
        """Fetch pending commands for this machine from Agent-Coding."""
        machine_id = urllib.parse.quote(str(self._identity.machine_id), safe="")
        path = f"/api/qb-agent/commands?machine_id={machine_id}"
        data = self._get(path)
        if data is None:
            return []

        raw_list = data if isinstance(data, list) else data.get("commands", [])
        commands = []
        for item in raw_list:
            status = str(item.get("status") or CommandStatus.PENDING.value)
            if status.upper() != CommandStatus.PENDING.value:
                continue
            command_id = str(item.get("command_id") or item.get("id") or "")
            command_type = str(item.get("command_type") or item.get("type") or "")
            if not command_id or not command_type:
                continue
            cmd = RemoteCommand(
                command_id=command_id,
                command_type=command_type,
                payload=_coerce_payload(item.get("payload_json", item.get("payload", {}))),
                status=status,
                created_at=item.get("created_at", ""),
            )
            commands.append(cmd)
        return commands

    # ── Command execution ─────────────────────────────────────────────────────

    def execute_command(self, cmd: RemoteCommand) -> dict:
        """Execute a single command, returns result dict."""
        ctype = CommandType.from_str(cmd.command_type)
        handler = self._handlers.get(ctype)

        if handler is None:
            logger.warning("[RemoteCmd] No handler for %s, using NoOpExecutor", ctype.value)
            handler = self._executor

        try:
            result = handler(cmd)
            cmd.status = CommandStatus.COMPLETED.value
            cmd.result = result
            return result
        except Exception as exc:
            logger.exception("[RemoteCmd] Handler failed for %s: %s", cmd.command_id, exc)
            cmd.status = CommandStatus.FAILED.value
            cmd.error = str(exc)
            cmd.result = {"ok": False, "error": str(exc)}
            return cmd.result

    def acknowledge(self, command_id: str) -> bool:
        return self._post(
            f"/api/qb-agent/commands/{command_id}/ack",
            {
                "command_id": command_id,
                "machine_id": self._identity.machine_id,
                "acknowledged_at": datetime.now(timezone.utc).isoformat(),
            },
        )

    def post_result(self, cmd: RemoteCommand) -> bool:
        status = _complete_status(cmd.status)
        payload = {
            "status": status,
            "result_json": cmd.result or {},
        }
        if cmd.error:
            payload["error_message"] = cmd.error
        return self._post(
            f"/api/qb-agent/commands/{cmd.command_id}/complete",
            payload,
        )

    def process_commands(self) -> int:
        """
        Poll + execute all pending commands.
        Returns number of commands processed.
        """
        commands = self.poll()
        processed = 0
        for cmd in commands:
            if cmd.command_id in self._seen_ids:
                logger.debug("[RemoteCmd] duplicate %s, skipping", cmd.command_id)
                continue
            self._seen_ids.add(cmd.command_id)

            ctype = CommandType.from_str(cmd.command_type)
            logger.info("[RemoteCmd] processing %s [%s]", ctype.value, cmd.command_id)

            # Acknowledge
            self.acknowledge(cmd.command_id)

            # Execute
            cmd.started_at = datetime.now(timezone.utc).isoformat()
            cmd.status = CommandStatus.RUNNING.value

            result = self.execute_command(cmd)

            cmd.completed_at = datetime.now(timezone.utc).isoformat()

            # Post result
            self.post_result(cmd)
            processed += 1

            logger.info("[RemoteCmd] %s [%s] -> %s", ctype.value, cmd.command_id, cmd.status)
        return processed

    # ── Polling loop ──────────────────────────────────────────────────────────

    def start(self) -> None:
        """Start the background polling thread."""
        if self._poll_thread is not None and self._poll_thread.is_alive():
            return
        self._stop_event.clear()
        self._poll_thread = threading.Thread(target=self._run_loop, daemon=True)
        self._poll_thread.start()
        logger.info("[RemoteCmd] started polling every %ss", self._poll_seconds)

    def stop(self) -> None:
        self._stop_event.set()
        if self._poll_thread:
            self._poll_thread.join(timeout=10)

    def _run_loop(self) -> None:
        while True:
            self.process_commands()
            if self._stop_event.wait(timeout=self._poll_seconds):
                break
        logger.info("[RemoteCmd] polling loop stopped")


def _coerce_payload(value: Any) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            decoded = json.loads(value)
            return decoded if isinstance(decoded, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _complete_status(status: str) -> str:
    normalized = str(status or "").upper()
    if normalized == CommandStatus.COMPLETED.value:
        return "completed"
    if normalized == CommandStatus.TIMEOUT.value:
        return "timeout"
    if normalized == CommandStatus.FAILED.value:
        return "failed"
    return str(status or "completed").lower()
