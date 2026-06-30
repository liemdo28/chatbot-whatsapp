from __future__ import annotations

import json
import os
import sys
import threading
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1]
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

from pywinauto import Desktop

from services.download_reports_service import run_download


AUDIT_ROOT = Path(__file__).resolve().parents[2] / "reports" / "evidence" / "raw-sushi-live-audit-2026-06-30"
SUMMARY_JSON = AUDIT_ROOT / "download-audit-summary.json"
SUMMARY_TXT = AUDIT_ROOT / "download-audit-summary.txt"
WINDOW_DIR = AUDIT_ROOT / "window-captures"

DEFAULT_DATES = [
    "2026-06-23",
    "2026-06-24",
    "2026-06-25",
    "2026-06-26",
    "2026-06-27",
    "2026-06-28",
    "2026-06-29",
]

WINDOW_TARGETS: list[tuple[str, str]] = [
    ("app", "Toast POS Manager"),
    ("qb", "Raw Japanese Bistro and Sushi Bar"),
    ("toast", "Toast"),
    ("chrome", "Chrome"),
]


def ensure_dirs() -> None:
    AUDIT_ROOT.mkdir(parents=True, exist_ok=True)
    WINDOW_DIR.mkdir(parents=True, exist_ok=True)


def make_logger(lines: list[str]):
    def _log(message: str) -> None:
        stamped = f"[{datetime.now().strftime('%H:%M:%S')}] {message}"
        print(stamped, flush=True)
        lines.append(stamped)
        SUMMARY_TXT.write_text("\n".join(lines), encoding="utf-8")

    return _log


def resolve_dates() -> list[str]:
    raw_dates = str(os.environ.get("AUDIT_DATES") or "").strip()
    if raw_dates:
        return [item.strip() for item in raw_dates.split(",") if item.strip()]
    date_start = str(os.environ.get("AUDIT_DATE_START") or "").strip()
    date_end = str(os.environ.get("AUDIT_DATE_END") or "").strip()
    if date_start and date_end:
        result = []
        current = datetime.strptime(date_start, "%Y-%m-%d").date()
        end = datetime.strptime(date_end, "%Y-%m-%d").date()
        while current <= end:
            result.append(current.isoformat())
            current = current.fromordinal(current.toordinal() + 1)
        return result
    return list(DEFAULT_DATES)


def capture_windows(stop_event: threading.Event, log) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    desktop = Desktop(backend="uia")

    while not stop_event.is_set():
        try:
            windows = [w for w in desktop.windows() if w.window_text()]
            for key, needle in WINDOW_TARGETS:
                match = next((w for w in windows if needle.lower() in w.window_text().lower()), None)
                if match is None:
                    continue
                if not match.is_visible():
                    continue
                title_slug = "".join(ch if ch.isalnum() else "-" for ch in match.window_text())[:80].strip("-")
                out = WINDOW_DIR / f"{key}-{counts[key]:03d}-{title_slug}.png"
                match.capture_as_image().save(out)
                counts[key] += 1
        except Exception as exc:
            log(f"Window capture warning: {exc}")
        stop_event.wait(8.0)

    return dict(counts)


def main() -> int:
    ensure_dirs()
    lines: list[str] = []
    log = make_logger(lines)
    stop_event = threading.Event()
    capture_counts_holder: dict[str, int] = {}
    dates = resolve_dates()
    result = None
    error_message = ""

    def _capture_runner():
        capture_counts_holder.update(capture_windows(stop_event, log))

    log("Starting live Raw Sushi / Stockton download audit")
    log(f"Target dates: {', '.join(dates)}")
    log("Report type: sales_summary")

    t = threading.Thread(target=_capture_runner, daemon=True)
    t.start()

    started = datetime.now().isoformat(timespec="seconds")
    try:
        result = run_download(
            stores=["Stockton"],
            date_start=dates[0],
            date_end=dates[-1],
            report_types=["sales_summary"],
            on_progress=log,
        )
    except Exception as exc:
        error_message = str(exc)
        log(f"Audit run error: {exc}")
    finally:
        stop_event.set()
        t.join(timeout=15)

    finished = datetime.now().isoformat(timespec="seconds")
    payload = {
        "started_at": started,
        "finished_at": finished,
        "store": "Stockton",
        "business_dates": dates,
        "report_type": "sales_summary",
        "ok": bool(result.ok) if result is not None else False,
        "success_count": int(result.success_count) if result is not None else 0,
        "fail_count": int(result.fail_count) if result is not None else 0,
        "total_count": int(result.total_count) if result is not None else 0,
        "warnings": list(result.warnings) if result is not None else ([error_message] if error_message else []),
        "files": [
            {
                "store": item.store,
                "date": item.date,
                "report_type": item.report_type,
                "success": item.success,
                "file_path": item.file_path,
                "error": item.error,
            }
            for item in (result.files if result is not None else [])
        ],
        "window_capture_counts": capture_counts_holder,
        "error": error_message,
    }

    SUMMARY_JSON.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    SUMMARY_TXT.write_text("\n".join(lines), encoding="utf-8")

    print(f"SUMMARY_JSON={SUMMARY_JSON}")
    print(f"SUMMARY_TXT={SUMMARY_TXT}")
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0 if result is not None and result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
