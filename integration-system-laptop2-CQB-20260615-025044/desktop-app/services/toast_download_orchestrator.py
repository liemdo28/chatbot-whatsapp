"""Hybrid Toast download orchestrator.

Mode behavior:
  PLAYWRIGHT_STATIC  -> current deterministic Playwright downloader only
  BROWSER_USE_AGENT  -> optional Browser-Use layer only
  HYBRID_FALLBACK    -> Playwright first, Browser-Use on selector/navigation failure
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from app_paths import runtime_path
from services.toast_browser_agent import (
    AUTOMATION_BROWSER_USE_AGENT,
    AUTOMATION_HYBRID_FALLBACK,
    AUTOMATION_PLAYWRIGHT_STATIC,
    STATUS_BROWSER_USE_FAILED,
    STATUS_BROWSER_USE_RUNNING,
    STATUS_DOWNLOAD_COMPLETED,
    STATUS_DOWNLOAD_STARTED,
    STATUS_HUMAN_REQUIRED,
    STATUS_PLAYWRIGHT_FAILED,
    STATUS_PLAYWRIGHT_RUNNING,
    STATUS_REPORT_INVALID,
    STATUS_REPORT_VALIDATED,
    classify_browser_blocker,
    merge_toast_download_config,
    normalize_automation_mode,
)
from services.toast_browser_use_downloader import BrowserUseDownloadResult, ToastBrowserUseDownloader
from services.toast_human_handoff import create_handoff
from services.toast_report_validator import ToastReportValidation, validate_downloaded_report


TOAST_EVENT_PREFIX = "TOAST_"


@dataclass
class ToastDownloadRequest:
    store: str
    business_date: str
    report_type: str = "sales_summary"


@dataclass
class ToastDownloadResult:
    status: str
    automation_mode: str
    store: str
    business_date: str
    report_type: str
    ok: bool = False
    file_path: str = ""
    file_size: int = 0
    error: str = ""
    human_required: bool = False
    playwright_attempted: bool = False
    browser_use_attempted: bool = False
    events: list[str] = field(default_factory=list)
    validation: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "automation_mode": self.automation_mode,
            "store": self.store,
            "business_date": self.business_date,
            "report_type": self.report_type,
            "ok": self.ok,
            "file_path": self.file_path,
            "file_size": self.file_size,
            "error": self.error,
            "human_required": self.human_required,
            "playwright_attempted": self.playwright_attempted,
            "browser_use_attempted": self.browser_use_attempted,
            "events": list(self.events),
            "validation": dict(self.validation),
        }


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _emit_event(client, event_type: str, result: ToastDownloadResult, payload: dict | None = None) -> None:
    result.events.append(event_type)
    body = {
        "store": result.store,
        "business_date": result.business_date,
        "automation_mode": result.automation_mode,
        "status": result.status,
        "report_type": result.report_type,
        "file_path": result.file_path,
        "file_size": result.file_size,
        "error": result.error,
        "human_required": result.human_required,
        "occurred_at": utc_now_iso(),
    }
    body.update(payload or {})
    if client is None:
        return
    try:
        client.event(event_type, event_type, severity="error" if "FAILED" in event_type or "INVALID" in event_type else "info", payload=body)
    except Exception:
        pass


def _default_playwright_runner(request: ToastDownloadRequest, download_dir: Path):
    from services.download_reports_service import run_download
    return run_download(
        stores=[request.store],
        date_start=request.business_date,
        date_end=request.business_date,
        report_types=[request.report_type],
    )


def _playwright_succeeded(playwright_result) -> tuple[bool, str, str]:
    warnings = list(getattr(playwright_result, "warnings", []) or [])
    files = list(getattr(playwright_result, "files", []) or [])
    successful = [item for item in files if getattr(item, "success", False)]
    file_path = ""
    for item in successful:
        file_path = str(getattr(item, "path", "") or getattr(item, "file_path", "") or "")
        if file_path:
            break
    if successful and not warnings:
        return True, file_path, ""
    errors = warnings or [str(getattr(item, "error", "")) for item in files if getattr(item, "error", "")]
    return False, file_path, "; ".join([e for e in errors if e]) or "Playwright did not download a valid report"


def _validate_if_file(
    result: ToastDownloadResult,
    *,
    expected_store: str,
    expected_date: str,
) -> ToastReportValidation | None:
    if not result.file_path:
        return None
    validation = validate_downloaded_report(
        result.file_path,
        report_type=result.report_type,
        expected_store=expected_store,
        expected_date=expected_date,
    )
    result.validation = validation.to_dict()
    result.file_size = validation.file_size
    if validation.ok:
        result.status = STATUS_REPORT_VALIDATED
        result.ok = True
    else:
        result.status = STATUS_REPORT_INVALID
        result.ok = False
        result.error = "; ".join(validation.errors)
    return validation


def run_toast_download(
    request: ToastDownloadRequest,
    *,
    config: dict | None = None,
    playwright_runner: Callable[[ToastDownloadRequest, Path], Any] | None = None,
    browser_use_downloader: Any = None,
    mi_core_client=None,
) -> ToastDownloadResult:
    cfg = merge_toast_download_config(config)
    mode = normalize_automation_mode(cfg.get("automation_mode"))
    download_dir = Path(cfg.get("download_dir") or runtime_path("toast-reports"))
    result = ToastDownloadResult(
        status=STATUS_DOWNLOAD_STARTED,
        automation_mode=mode,
        store=request.store,
        business_date=request.business_date,
        report_type=request.report_type,
    )
    _emit_event(mi_core_client, "TOAST_DOWNLOAD_STARTED", result)

    if not cfg.get("enabled", True):
        result.status = STATUS_HUMAN_REQUIRED
        result.error = "Toast download automation disabled by config"
        result.human_required = True
        _emit_event(mi_core_client, "TOAST_HUMAN_REQUIRED", result)
        return result

    should_try_playwright = mode in {AUTOMATION_PLAYWRIGHT_STATIC, AUTOMATION_HYBRID_FALLBACK}
    should_try_browser_use = mode in {AUTOMATION_BROWSER_USE_AGENT, AUTOMATION_HYBRID_FALLBACK}

    if should_try_playwright:
        result.playwright_attempted = True
        result.status = STATUS_PLAYWRIGHT_RUNNING
        _emit_event(mi_core_client, "TOAST_PLAYWRIGHT_RUNNING", result)
        try:
            runner = playwright_runner or _default_playwright_runner
            pw_result = runner(request, download_dir)
            ok, file_path, error = _playwright_succeeded(pw_result)
            result.file_path = file_path
            if ok:
                result.status = STATUS_DOWNLOAD_COMPLETED
                _emit_event(mi_core_client, "TOAST_DOWNLOAD_COMPLETED", result)
                validation = _validate_if_file(result, expected_store=request.store, expected_date=request.business_date)
                _emit_event(mi_core_client, "TOAST_REPORT_VALIDATED" if validation and validation.ok else "TOAST_REPORT_INVALID", result)
                return result
            result.status = STATUS_PLAYWRIGHT_FAILED
            result.error = error
            _emit_event(mi_core_client, "TOAST_PLAYWRIGHT_FAILED", result)
        except Exception as exc:
            result.status = STATUS_PLAYWRIGHT_FAILED
            result.error = str(exc)
            _emit_event(mi_core_client, "TOAST_PLAYWRIGHT_FAILED", result)

    if not should_try_browser_use:
        return result

    blocker_status = classify_browser_blocker(result.error)
    if blocker_status == STATUS_HUMAN_REQUIRED and mode == AUTOMATION_HYBRID_FALLBACK:
        result.status = STATUS_HUMAN_REQUIRED
        result.human_required = True
        create_handoff(reason=result.error, store=request.store, business_date=request.business_date, report_type=request.report_type)
        _emit_event(mi_core_client, "TOAST_HUMAN_REQUIRED", result)
        return result

    result.browser_use_attempted = True
    result.status = STATUS_BROWSER_USE_RUNNING
    _emit_event(mi_core_client, "TOAST_BROWSER_USE_STARTED", result)
    downloader = browser_use_downloader or ToastBrowserUseDownloader({"toast_download": cfg})
    bu_result: BrowserUseDownloadResult | dict = downloader.download_report(
        store=request.store,
        business_date=request.business_date,
        report_type=request.report_type,
        download_dir=download_dir,
    )
    if isinstance(bu_result, dict):
        bu_data = bu_result
    else:
        bu_data = bu_result.to_dict()

    result.file_path = str(bu_data.get("file_path") or "")
    result.error = str(bu_data.get("error") or "")
    result.human_required = bool(bu_data.get("human_required")) or bu_data.get("status") == STATUS_HUMAN_REQUIRED
    if result.human_required:
        result.status = STATUS_HUMAN_REQUIRED
        create_handoff(reason=result.error or "Browser-Use requires human action", store=request.store, business_date=request.business_date, report_type=request.report_type, screenshot_path=str(bu_data.get("screenshot_path") or ""))
        _emit_event(mi_core_client, "TOAST_HUMAN_REQUIRED", result)
        return result

    if not bu_data.get("ok"):
        result.status = STATUS_BROWSER_USE_FAILED
        result.error = result.error or "Browser-Use failed"
        _emit_event(mi_core_client, "TOAST_BROWSER_USE_FAILED", result)
        return result

    result.status = STATUS_DOWNLOAD_COMPLETED
    _emit_event(mi_core_client, "TOAST_BROWSER_USE_COMPLETED", result)
    validation = _validate_if_file(result, expected_store=request.store, expected_date=request.business_date)
    _emit_event(mi_core_client, "TOAST_REPORT_VALIDATED" if validation and validation.ok else "TOAST_REPORT_INVALID", result)
    return result
