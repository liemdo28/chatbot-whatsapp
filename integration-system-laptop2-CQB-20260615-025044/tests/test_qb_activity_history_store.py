"""
Tests for services/qb_activity_history_store.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

ROOT = Path(__file__).resolve().parents[1]
DESKTOP_APP = ROOT / "desktop-app"
if str(DESKTOP_APP) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP))

from services.qb_activity_history_store import (
    get_timeline,
    list_available_timelines,
    get_latest_timeline,
    get_summary_for_store,
)


def test_get_timeline_returns_none_when_file_missing(tmp_path):
    result = get_timeline("bandera", "2026-06-03", {"output_dir": str(tmp_path)})
    assert result is None


def test_get_timeline_returns_data_when_file_exists(tmp_path):
    store_dir = tmp_path / "bandera"
    store_dir.mkdir()
    data = {
        "store": "bandera", "date": "2026-06-03",
        "status": "PASS", "event_count": 5,
        "events": [{"type": "sales_receipt", "ref_number": "REF-001"}],
        "warnings": [], "errors": [],
    }
    (store_dir / "2026-06-03-timeline.json").write_text(
        json.dumps(data), encoding="utf-8"
    )
    result = get_timeline("BANDERA", "2026-06-03", {"output_dir": str(tmp_path)})
    assert result is not None
    assert result["store"] == "bandera"
    assert result["event_count"] == 5


def test_list_available_timelines_returns_empty_when_no_files(tmp_path):
    result = list_available_timelines("bandera", {"output_dir": str(tmp_path)})
    assert result == []


def test_list_available_timelines_returns_sorted_list(tmp_path):
    store_dir = tmp_path / "bandera"
    store_dir.mkdir()
    for date_str in ["2026-06-01", "2026-06-03", "2026-06-02"]:
        data = {
            "date": date_str, "status": "PASS",
            "event_count": 1, "generated_at": f"{date_str}T09:00:00",
        }
        (store_dir / f"{date_str}-timeline.json").write_text(
            json.dumps(data), encoding="utf-8"
        )

    result = list_available_timelines("bandera", {"output_dir": str(tmp_path)})
    assert len(result) == 3
    dates = [r["date"] for r in result]
    assert dates == ["2026-06-03", "2026-06-02", "2026-06-01"]  # most recent first


def test_list_available_timelines_respects_limit(tmp_path):
    store_dir = tmp_path / "bandera"
    store_dir.mkdir()
    for i in range(5):
        date_str = f"2026-06-0{i+1}"
        data = {"date": date_str, "status": "PASS", "event_count": 1, "generated_at": ""}
        (store_dir / f"{date_str}-timeline.json").write_text(
            json.dumps(data), encoding="utf-8"
        )

    result = list_available_timelines("bandera", {"output_dir": str(tmp_path)}, limit=3)
    assert len(result) == 3


def test_get_latest_timeline_returns_most_recent(tmp_path):
    store_dir = tmp_path / "stone_oak"
    store_dir.mkdir()
    for date_str, event_count in [("2026-06-01", 1), ("2026-06-03", 10), ("2026-06-02", 5)]:
        data = {
            "date": date_str, "status": "PASS",
            "event_count": event_count, "generated_at": "",
        }
        (store_dir / f"{date_str}-timeline.json").write_text(
            json.dumps(data), encoding="utf-8"
        )

    result = get_latest_timeline("stone_oak", {"output_dir": str(tmp_path)})
    assert result is not None
    assert result["date"] == "2026-06-03"
    assert result["event_count"] == 10


def test_get_summary_for_store_no_data():
    result = get_summary_for_store("unknown_store")
    assert result["store"] == "unknown_store"
    assert result["status"] == "NO_DATA"
    assert result["event_count"] == 0


def test_get_summary_for_store_with_data(tmp_path):
    store_dir = tmp_path / "bandera"
    store_dir.mkdir()
    data = {
        "date": "2026-06-03",
        "status": "PASS",
        "event_count": 3,
        "generated_at": "2026-06-03T09:15:00",
        "events": [
            {"type": "invoice", "time": "08:00", "txn_date": "2026-06-03"},
            {"type": "payment", "time": "09:00", "txn_date": "2026-06-03"},
            {"type": "deposit", "time": "10:30", "txn_date": "2026-06-03"},
        ],
        "warnings": ["No journal entries."],
        "errors": [],
    }
    (store_dir / "2026-06-03-timeline.json").write_text(
        json.dumps(data), encoding="utf-8"
    )

    result = get_summary_for_store("bandera", {"output_dir": str(tmp_path)})
    assert result["store"] == "bandera"
    assert result["status"] == "PASS"
    assert result["event_count"] == 3
    assert result["last_event_type"] == "deposit"
    assert result["last_event_time"] == "10:30"
    assert result["last_event_date"] == "2026-06-03"
    assert len(result["warnings"]) == 1
