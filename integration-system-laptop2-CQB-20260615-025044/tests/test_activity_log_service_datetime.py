from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest


class _AwareNow(datetime):
    @classmethod
    def now(cls, tz=None):
        value = datetime(2026, 6, 10, 12, 0, tzinfo=timezone.utc)
        return value if tz is None else value.astimezone(tz)


class _NaiveNow(datetime):
    @classmethod
    def now(cls, tz=None):
        value = datetime(2026, 6, 10, 12, 0)
        if tz is not None:
            return value.replace(tzinfo=timezone.utc).astimezone(tz)
        return value


def _write_log(log_dir, event_id="evt-1"):
    log_dir.mkdir()
    log_file = log_dir / "activity_202606.jsonl"
    log_file.write_text(
        json.dumps(
            {
                "event_id": event_id,
                "timestamp": "2026-06-10T02:02:42Z",
                "category": "app_lifecycle",
                "severity": "info",
                "title": "Startup",
                "detail": "",
                "store": None,
                "user_initiated": True,
                "success": True,
                "duration_seconds": None,
                "extra": {},
            }
        )
        + "\n",
        encoding="utf-8",
    )


def test_get_events_accepts_naive_since(monkeypatch, tmp_path):
    from services import activity_log_service as svc

    log_dir = tmp_path / "activity-logs"
    _write_log(log_dir)

    monkeypatch.setattr(svc, "LOG_DIR", log_dir)

    events = svc.get_events(since=datetime(2026, 6, 10), limit=10)

    assert len(events) == 1
    assert events[0].event_id == "evt-1"


@pytest.mark.parametrize(
    ("since", "datetime_cls"),
    [
        pytest.param(datetime(2026, 6, 10), _AwareNow, id="naive-start-aware-end"),
        pytest.param(datetime(2026, 6, 10, tzinfo=timezone.utc), _NaiveNow, id="aware-start-naive-end"),
        pytest.param(datetime(2026, 6, 10, tzinfo=timezone.utc), _AwareNow, id="aware-start-aware-end"),
        pytest.param(datetime(2026, 6, 10), _NaiveNow, id="naive-start-naive-end"),
    ],
)
def test_all_log_files_accepts_naive_and_aware_boundaries(monkeypatch, tmp_path, since, datetime_cls):
    from services import activity_log_service as svc

    log_dir = tmp_path / "activity-logs"
    _write_log(log_dir)

    monkeypatch.setattr(svc, "LOG_DIR", log_dir)
    monkeypatch.setattr(svc, "datetime", datetime_cls)

    files = svc._all_log_files(since)

    assert [p.name for p in files] == ["activity_202606.jsonl"]
