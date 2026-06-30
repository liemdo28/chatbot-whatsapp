"""Service layer for download reports — thin orchestration wrapper."""
from __future__ import annotations
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from models.download_result import DownloadResult, DownloadFileResult


def get_date_list(date_start: str, date_end: str) -> list:
    try:
        s = datetime.strptime(date_start, "%Y-%m-%d").date()
        e = datetime.strptime(date_end, "%Y-%m-%d").date()
        result = []
        cur = s
        while cur <= e:
            result.append(cur.strftime("%Y-%m-%d"))
            cur += timedelta(days=1)
        return result
    except Exception:
        return []


def estimate_download_count(stores: list, date_start: str, date_end: str, report_types: list) -> int:
    return len(stores) * len(get_date_list(date_start, date_end)) * len(report_types)


def _load_runtime_config() -> dict:
    try:
        from app_paths import RUNTIME_DIR

        cfg_path = RUNTIME_DIR / "local-config.json"
        if cfg_path.exists():
            return json.loads(cfg_path.read_text(encoding="utf-8-sig"))
    except Exception:
        pass
    return {}


def _drive_upload_requested(config: dict, upload_to_gdrive: bool | None) -> bool:
    if upload_to_gdrive is not None:
        return bool(upload_to_gdrive)
    drive_cfg = dict((config or {}).get("google_drive") or {})
    return bool(drive_cfg.get("root_folder_id") or drive_cfg.get("root_folder_url"))


def _prepare_gdrive(config: dict, on_progress=None):
    def _log(msg):
        if callable(on_progress):
            on_progress(msg)

    try:
        from gdrive_service import GDriveService

        drive = GDriveService(on_log=_log, config=config)
        if not drive.authenticate():
            status = getattr(drive, "last_auth_status", {}) or {}
            return None, status.get("message") or "Google Drive authentication failed"
        _log("Google Drive ready. Successful downloads will upload immediately.")
        return drive, ""
    except Exception as exc:
        return None, str(exc)


def run_playwright_download_request(
    request,
    *,
    download_dir: str | Path | None = None,
    on_progress=None,
    stop_event=None,
):
    """Run the deterministic Toast downloader for a single store/date/report request."""
    from toast_downloader import ToastDownloader

    def _log(msg):
        if callable(on_progress):
            on_progress(msg)

    target_dir = Path(download_dir) if download_dir else None
    should_stop = (stop_event.is_set if stop_event is not None else (lambda: False))
    downloader = ToastDownloader(
        on_log=_log,
        should_stop=should_stop,
        download_dir=str(target_dir) if target_dir else None,
    )

    display_date = datetime.strptime(request.business_date, "%Y-%m-%d").strftime("%m/%d/%Y")
    raw = downloader.download_reports_daterange(
        locations=[request.store],
        dates=[display_date],
        report_types=[request.report_type],
    )

    result = DownloadResult(
        stores=[request.store],
        date_start=request.business_date,
        date_end=request.business_date,
        report_types=[request.report_type],
        started_at=datetime.now(timezone.utc).isoformat(),
    )

    files = list(raw.get("files", []) or [])
    warnings = list(raw.get("warnings", []) or [])
    if files:
        for item in files:
            path = str(item.get("filepath") or item.get("file_path") or "")
            status = str(item.get("status") or "").strip().lower()
            success = bool(item.get("success", False))
            if not success and status in {"downloaded", "existing", "no_data"}:
                success = True
            if not success and path:
                success = True
            result.files.append(
                DownloadFileResult(
                    store=request.store,
                    date=request.business_date,
                    report_type=request.report_type,
                    success=success,
                    file_path=path,
                    error=str(item.get("error") or ""),
                )
            )
    else:
        success_count = int(raw.get("success", 0) or 0)
        total_count = int(raw.get("total", success_count) or 0)
        success = success_count > 0 and total_count == success_count and not warnings
        result.files.append(
            DownloadFileResult(
                store=request.store,
                date=request.business_date,
                report_type=request.report_type,
                success=success,
                error="" if success else "; ".join(warnings) or "Playwright did not download a valid report",
            )
        )

    result.warnings.extend(warnings)
    result.finished_at = datetime.now(timezone.utc).isoformat()
    return result


def run_download(
    stores: list,
    date_start: str,
    date_end: str,
    report_types: list,
    on_progress=None,
    stop_event=None,
    config: dict | None = None,
    mi_core_client=None,
    upload_to_gdrive: bool | None = None,
) -> DownloadResult:
    """Run the download workflow and return a DownloadResult."""
    result = DownloadResult(
        stores=stores,
        date_start=date_start,
        date_end=date_end,
        report_types=report_types,
        started_at=datetime.now(timezone.utc).isoformat(),
    )

    def _log(msg):
        if callable(on_progress):
            on_progress(msg)

    date_list = get_date_list(date_start, date_end)
    if not date_list:
        result.warnings.append("No valid dates in range.")
        result.finished_at = datetime.now(timezone.utc).isoformat()
        return result

    try:
        from services.toast_download_orchestrator import ToastDownloadRequest, run_toast_download

        cfg = config or _load_runtime_config()
        gdrive = None
        if _drive_upload_requested(cfg, upload_to_gdrive):
            gdrive, drive_error = _prepare_gdrive(cfg, on_progress=on_progress)
            if gdrive is None and drive_error:
                result.warnings.append(f"Google Drive upload unavailable: {drive_error}")

        for store in stores:
            if stop_event and stop_event.is_set():
                _log(f"Stopped before {store}")
                break

            for d in date_list:
                if stop_event and stop_event.is_set():
                    _log(f"Stopped before {store} / {d}")
                    break

                for rt in report_types:
                    if stop_event and stop_event.is_set():
                        _log(f"Stopped before {store} / {d} / {rt}")
                        break

                    _log(f"Starting Toast download: {store} / {d} / {rt}...")
                    try:
                        toast_result = run_toast_download(
                            ToastDownloadRequest(store=store, business_date=d, report_type=rt),
                            config=cfg,
                            playwright_runner=lambda request, download_dir: run_playwright_download_request(
                                request,
                                download_dir=download_dir,
                                on_progress=_log,
                                stop_event=stop_event,
                            ),
                            mi_core_client=mi_core_client,
                        )
                        file_success = bool(toast_result.ok)
                        file_error = str(toast_result.error or "")
                        uploaded_to_drive = False
                        if file_success and toast_result.file_path and gdrive:
                            try:
                                gdrive.upload_report(str(toast_result.file_path), store, report_type=rt)
                                uploaded_to_drive = True
                            except Exception as upload_error:
                                file_error = str(upload_error)
                                result.warnings.append(
                                    f"{store}/{d}/{rt}: drive upload failed - {upload_error}"
                                )
                                _log(f"{store} / {d} / {rt}: Drive upload failed - {upload_error}")
                        result.files.append(
                            DownloadFileResult(
                                store=store,
                                date=d,
                                report_type=rt,
                                success=file_success,
                                file_path=str(toast_result.file_path or ""),
                                error=file_error,
                                uploaded_to_drive=uploaded_to_drive,
                            )
                        )
                        if file_success:
                            if uploaded_to_drive:
                                _log(f"{store} / {d} / {rt}: downloaded + uploaded -> {toast_result.file_path}")
                            else:
                                _log(f"{store} / {d} / {rt}: downloaded -> {toast_result.file_path}")
                        else:
                            status = toast_result.status or "FAILED"
                            msg = f"{store}/{d}/{rt}: {status}"
                            if toast_result.error:
                                msg = f"{msg} - {toast_result.error}"
                            result.warnings.append(msg)
                            _log(f"{store} / {d} / {rt}: {status}")
                    except Exception as e:
                        _log(f"{store} / {d} / {rt}: Error — {e}")
                        result.warnings.append(f"{store}/{d}/{rt}: {e}")
                        result.files.append(
                            DownloadFileResult(
                                store=store,
                                date=d,
                                report_type=rt,
                                success=False,
                                error=str(e),
                            )
                        )
    except Exception as e:
        result.warnings.append(f"Download engine error: {e}")

    result.finished_at = datetime.now(timezone.utc).isoformat()
    return result
