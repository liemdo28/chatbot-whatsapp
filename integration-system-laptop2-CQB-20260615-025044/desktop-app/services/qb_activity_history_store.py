"""
QB Activity History Store
==========================
Provides a simple interface to query and retrieve historical timeline data
from the filesystem, without connecting to QuickBooks.

Used by the UI to display past timelines without re-querying QB.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

_log = logging.getLogger(__name__)

# ── Path helpers ──────────────────────────────────────────────────────────────

def _get_output_dir(config: Optional[dict] = None) -> Path:
    """Resolve the timeline output directory from config or local-config.json."""
    if config:
        output_dir = config.get("output_dir") or "logs/qb-activity"
    else:
        try:
            import json as _json
            from app_paths import runtime_path
            cfg_path = runtime_path("local-config.json")
            if cfg_path.exists():
                config = _json.loads(cfg_path.read_text(encoding="utf-8-sig"))
                output_dir = config.get("qb_activity_log", {}).get("output_dir") or "logs/qb-activity"
            else:
                output_dir = "logs/qb-activity"
        except Exception:
            output_dir = "logs/qb-activity"
    from app_paths import runtime_path
    return runtime_path(output_dir)


def get_timeline(store_code: str, date_str: str, config: Optional[dict] = None) -> Optional[dict]:
    """
    Load a stored timeline for the given store and date.

    Returns None if the file does not exist.
    """
    try:
        output_dir = _get_output_dir(config)
        path = output_dir / store_code.lower() / f"{date_str}-timeline.json"
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception as exc:
        _log.warning("Could not load timeline for %s/%s: %s", store_code, date_str, exc)
        return None


def list_available_timelines(
    store_code: str,
    config: Optional[dict] = None,
    limit: int = 30,
) -> list[dict]:
    """
    List available timeline files for a store, most recent first.

    Returns list of dicts: {date, path, status, event_count, generated_at}
    """
    try:
        output_dir = _get_output_dir(config)
        store_dir = output_dir / store_code.lower()
        if not store_dir.exists():
            return []

        timelines: list[dict] = []
        for path in sorted(store_dir.glob("*-timeline.json"), reverse=True):
            if len(timelines) >= limit:
                break
            try:
                data = json.loads(path.read_text(encoding="utf-8-sig"))
                timelines.append({
                    "date": data.get("date", path.stem.replace("-timeline", "")),
                    "path": str(path),
                    "status": data.get("status", "UNKNOWN"),
                    "event_count": data.get("event_count", 0),
                    "generated_at": data.get("generated_at", ""),
                })
            except Exception:
                continue

        return timelines
    except Exception as exc:
        _log.warning("Could not list timelines for %s: %s", store_code, exc)
        return []


def get_latest_timeline(
    store_code: str,
    config: Optional[dict] = None,
) -> Optional[dict]:
    """
    Load the most recent timeline for a store.
    """
    timelines = list_available_timelines(store_code, config, limit=1)
    if not timelines:
        return None
    return get_timeline(store_code, timelines[0]["date"], config)


def get_summary_for_store(
    store_code: str,
    config: Optional[dict] = None,
) -> dict:
    """
    Return a summary of the latest timeline for a store.
    Used by the Home Dashboard timeline panel.
    """
    latest = get_latest_timeline(store_code, config)
    if not latest:
        return {
            "store": store_code,
            "status": "NO_DATA",
            "event_count": 0,
            "last_event_type": "—",
            "last_event_time": "—",
            "last_event_date": "—",
            "generated_at": "—",
            "warnings": [],
            "errors": [],
        }

    events = latest.get("events") or []
    last_event = events[-1] if events else {}

    return {
        "store": store_code,
        "status": latest.get("status", "UNKNOWN"),
        "event_count": latest.get("event_count", 0),
        "last_event_type": last_event.get("type", "—") if last_event else "—",
        "last_event_time": last_event.get("time", "—") if last_event else "—",
        "last_event_date": last_event.get("txn_date", "—") if last_event else "—",
        "generated_at": latest.get("generated_at", "—"),
        "warnings": latest.get("warnings") or [],
        "errors": latest.get("errors") or [],
    }
