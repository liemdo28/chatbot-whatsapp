"""
reporting_outbox.py
===================
Offline-safe event queue for Agent-Coding.

When Agent-Coding is unreachable, events/heartbeats/results are written to
local JSON files and retried every 5 minutes.

Rules:
  - Never delete a file until confirmed sent.
  - Preserve order (FIFO).
  - Keep up to 30 days.
  - Max 1000 pending entries (oldest are evicted after age check).

Directory: runtime/reporting-outbox/
File naming: <event-id>_<timestamp>.json
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from json_file_utils import load_json_file

try:
    from app_paths import RUNTIME_DIR
except ImportError:
    RUNTIME_DIR = Path(__file__).resolve().parent.parent

OUTBOX_DIR = RUNTIME_DIR / "reporting-outbox"
MAX_AGE_DAYS = 30
MAX_PENDING = 1000
RETRY_INTERVAL_SECONDS = 300  # 5 minutes

logger = logging.getLogger("reporting_outbox")

_lock = threading.RLock()
_instance: Optional["ReportingOutbox"] = None


def get_outbox() -> "ReportingOutbox":
    global _instance
    with _lock:
        if _instance is None:
            _instance = ReportingOutbox()
        return _instance


class ReportingOutbox:
    """
    Persistent offline queue backed by JSON files.

    enqueue()   → writes file to OUTBOX_DIR
    flush()     → attempts to POST all pending entries to Agent-Coding
    count()     → returns number of pending files
    prune()     → removes files older than MAX_AGE_DAYS
    """

    def __init__(
        self,
        outbox_dir: Optional[Path] = None,
        retry_interval: int = RETRY_INTERVAL_SECONDS,
        max_age_days: int = MAX_AGE_DAYS,
        max_pending: int = MAX_PENDING,
    ):
        self._dir = outbox_dir or OUTBOX_DIR
        self._retry_interval = retry_interval
        self._max_age_days = max_age_days
        self._max_pending = max_pending
        self._dir.mkdir(parents=True, exist_ok=True)
        self._stop_event: Optional[threading.Event] = None
        self._worker: Optional[threading.Thread] = None

    # ── Core operations ──────────────────────────────────────────────────────

    def enqueue(self, entry: dict) -> str:
        """
        Write entry to a JSON file in the outbox directory.
        Returns the filename.
        """
        # Use monotonic high-resolution counter for uniqueness even when called rapidly
        event_id = entry.get("event_id")
        if not event_id:
            event_id = f"e{int(time.time() * 1_000_000)}"
        timestamp = int(time.time() * 1_000_000)  # microsecond precision
        filename = f"{event_id}_{timestamp}.json"
        path = self._dir / filename
        with open(path, "w", encoding="utf-8") as f:
            json.dump(entry, f, indent=2, ensure_ascii=False)
        logger.debug("[Outbox] enqueued %s", filename)
        return filename

    def pending_files(self) -> list[Path]:
        """Return sorted list of pending JSON files (oldest first)."""
        if not self._dir.exists():
            return []
        files = [
            self._dir / f
            for f in os.listdir(self._dir)
            if f.endswith(".json")
        ]
        files.sort(key=lambda p: p.stat().st_mtime)
        return files

    def count(self) -> int:
        return len(self.pending_files())

    def read_entry(self, path: Path) -> Optional[dict]:
        try:
            return load_json_file(path)
        except Exception as exc:
            logger.warning("[Outbox] failed to read %s: %s", path.name, exc)
            return None

    def remove_entry(self, path: Path) -> None:
        """Delete a single outbox entry file (only after confirmed sent)."""
        try:
            path.unlink(missing_ok=True)
            logger.debug("[Outbox] removed %s", path.name)
        except OSError as exc:
            logger.warning("[Outbox] failed to remove %s: %s", path.name, exc)

    def remove_batch(self, paths: list[Path]) -> None:
        for p in paths:
            self.remove_entry(p)

    # ── Flush / retry ───────────────────────────────────────────────────────

    def flush(self, client: Optional["AgentCodingClient"] = None) -> tuple[int, int]:
        """
        Attempt to POST all pending outbox entries to Agent-Coding.

        Args:
            client: AgentCodingClient instance. If None, creates one.

        Returns:
            (sent_count, failed_count)
        """
        # Lazy import to avoid circular dependency
        if client is None:
            try:
                from services.agent_coding_client import get_client
                client = get_client()
            except Exception:
                logger.warning("[Outbox] flush skipped: cannot get AgentCodingClient")
                return 0, self.count()

        pending = self.pending_files()
        if not pending:
            return 0, 0

        sent = 0
        failed = 0

        for path in pending:
            entry = self.read_entry(path)
            if entry is None:
                # Corrupt file — remove it
                self.remove_entry(path)
                continue

            method = entry.get("method", "POST").upper()
            path_url = entry.get("path", "")
            payload = entry.get("payload", {})

            ok = False
            if method == "POST":
                ok = client._post(path_url, payload, retry_count=1)
            else:
                logger.warning("[Outbox] unknown method %s for %s", method, path.name)

            if ok:
                self.remove_entry(path)
                sent += 1
            else:
                failed += 1

        logger.info(
            "[Outbox] flush done: sent=%s, failed=%s, remaining=%s",
            sent, failed, self.count(),
        )
        return sent, failed

    # ── Prune old entries ───────────────────────────────────────────────────

    def prune(self) -> int:
        """
        Remove entries older than MAX_AGE_DAYS.
        Also enforce MAX_PENDING by removing oldest if over limit.
        Returns number of removed files.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(days=self._max_age_days)
        pending = self.pending_files()
        removed = 0

        for path in pending:
            mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
            if mtime < cutoff:
                self.remove_entry(path)
                removed += 1
                continue

            # Check for corrupt or empty files
            try:
                if path.stat().st_size == 0:
                    self.remove_entry(path)
                    removed += 1
                    continue
            except OSError:
                self.remove_entry(path)
                removed += 1

        # Enforce max pending (remove oldest beyond limit)
        excess = len(pending) - self._max_pending
        if excess > 0:
            for path in pending[:excess]:
                self.remove_entry(path)
                removed += 1

        if removed:
            logger.info("[Outbox] pruned %s old entries", removed)
        return removed

    # ── Background retry worker ──────────────────────────────────────────────

    def start_worker(self) -> None:
        """Start the background flush+prune thread."""
        if self._worker is not None and self._worker.is_alive():
            return
        self._stop_event = threading.Event()
        self._worker = threading.Thread(target=self._run_worker, daemon=True)
        self._worker.start()
        logger.info("[Outbox] worker started (interval=%ss)", self._retry_interval)

    def stop_worker(self) -> None:
        if self._stop_event:
            self._stop_event.set()
        if self._worker:
            self._worker.join(timeout=5)

    def _run_worker(self) -> None:
        while True:
            self.prune()
            self.flush()
            if self._stop_event and self._stop_event.wait(timeout=self._retry_interval):
                break

    # ── Diagnostic ─────────────────────────────────────────────────────────

    def summary(self) -> dict:
        """Return a diagnostic summary dict."""
        pending = self.pending_files()
        now = datetime.now(timezone.utc)
        age_counts = {"<1h": 0, "1-24h": 0, "1-7d": 0, "7-30d": 0, ">30d": 0}
        for p in pending:
            age = now - datetime.fromtimestamp(p.stat().st_mtime, tz=timezone.utc)
            if age < timedelta(hours=1):
                age_counts["<1h"] += 1
            elif age < timedelta(days=1):
                age_counts["1-24h"] += 1
            elif age < timedelta(days=7):
                age_counts["1-7d"] += 1
            elif age < timedelta(days=30):
                age_counts["7-30d"] += 1
            else:
                age_counts[">30d"] += 1
        return {
            "total_pending": len(pending),
            "outbox_dir": str(self._dir),
            "age_distribution": age_counts,
            "worker_alive": self._worker.is_alive() if self._worker else False,
        }
