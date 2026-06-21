"""Optional Browser-Use based Toast report downloader.

This module is import-safe when browser-use is not installed.  The existing
Playwright pipeline remains the primary production path.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from services.toast_browser_agent import (
    STATUS_BROWSER_USE_FAILED,
    STATUS_DOWNLOAD_COMPLETED,
    STATUS_HUMAN_REQUIRED,
    ToastBrowserTask,
    assert_task_is_safe,
    build_browser_use_task,
    classify_browser_blocker,
    is_browser_use_enabled,
    merge_toast_download_config,
)


@dataclass
class BrowserUseDownloadResult:
    status: str
    ok: bool = False
    file_path: str = ""
    screenshot_path: str = ""
    error: str = ""
    human_required: bool = False
    raw_result: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "ok": self.ok,
            "file_path": self.file_path,
            "screenshot_path": self.screenshot_path,
            "error": self.error,
            "human_required": self.human_required,
            "raw_result": self.raw_result,
            "metadata": dict(self.metadata),
        }


class BrowserUseUnavailableError(RuntimeError):
    pass


class ToastBrowserUseDownloader:
    def __init__(self, config: dict | None = None, on_log=None):
        self.config = merge_toast_download_config(config)
        self.on_log = on_log or (lambda msg: None)

    def log(self, message: str) -> None:
        try:
            self.on_log(message)
        except Exception:
            pass

    @staticmethod
    def is_available() -> tuple[bool, str]:
        try:
            import browser_use  # noqa: F401
            return True, "browser-use import ok"
        except Exception as exc:
            return False, str(exc)

    def _import_browser_use(self):
        try:
            from browser_use.beta import Agent, BrowserProfile, ChatOpenAI
            return Agent, BrowserProfile, ChatOpenAI
        except Exception:
            try:
                from browser_use import Agent, ChatOpenAI
                from browser_use import BrowserProfile  # type: ignore
                return Agent, BrowserProfile, ChatOpenAI
            except Exception as exc:
                raise BrowserUseUnavailableError(str(exc)) from exc

    async def _run_agent(self, task_text: str, download_dir: Path) -> str:
        Agent, BrowserProfile, ChatOpenAI = self._import_browser_use()
        bu_cfg = dict(self.config.get("browser_use") or {})
        profile_cfg = dict(self.config.get("browser_profile") or {})
        profile_path = str(profile_cfg.get("profile_path") or "").strip() or None

        browser_profile = BrowserProfile(
            headless=bool(bu_cfg.get("headless", False)),
            allowed_domains=list(self.config.get("allowed_domains") or ["*.toasttab.com"]),
            downloads_path=str(download_dir),
            user_data_dir=profile_path,
        )
        llm = ChatOpenAI(model=str(bu_cfg.get("model") or "gpt-5.5"))
        agent = Agent(task=task_text, llm=llm, browser_profile=browser_profile)
        history = await asyncio.wait_for(
            agent.run(max_steps=int(bu_cfg.get("max_steps") or 40)),
            timeout=int(bu_cfg.get("timeout_seconds") or 180),
        )
        final_result = getattr(history, "final_result", None)
        return str(final_result() if callable(final_result) else history)

    def download_report(
        self,
        *,
        store: str,
        business_date: str,
        report_type: str,
        download_dir: str | Path,
    ) -> BrowserUseDownloadResult:
        if not is_browser_use_enabled({"toast_download": self.config}):
            return BrowserUseDownloadResult(
                status=STATUS_BROWSER_USE_FAILED,
                error="Browser-Use is disabled by config",
            )

        available, reason = self.is_available()
        if not available:
            return BrowserUseDownloadResult(
                status=STATUS_BROWSER_USE_FAILED,
                error=f"browser-use is not installed: {reason}",
            )

        target_dir = Path(download_dir)
        target_dir.mkdir(parents=True, exist_ok=True)
        before = {p.resolve() for p in target_dir.glob("*") if p.is_file()}

        task = ToastBrowserTask(
            store=store,
            business_date=business_date,
            report_type=report_type,
            download_dir=target_dir,
        )
        task_text = build_browser_use_task(task, {"toast_download": self.config})
        assert_task_is_safe(task_text)

        try:
            self.log("Browser-Use Toast download started")
            raw = asyncio.run(self._run_agent(task_text, target_dir))
        except Exception as exc:
            status = classify_browser_blocker(str(exc))
            return BrowserUseDownloadResult(
                status=status,
                error=str(exc),
                human_required=status == STATUS_HUMAN_REQUIRED,
            )

        lowered = raw.lower()
        status = classify_browser_blocker(raw)
        if status == STATUS_HUMAN_REQUIRED:
            return BrowserUseDownloadResult(
                status=STATUS_HUMAN_REQUIRED,
                human_required=True,
                raw_result=raw,
                error="Browser-Use requested human login/approval",
            )

        after = [p for p in target_dir.glob("*") if p.is_file() and p.resolve() not in before]
        after.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        file_path = str(after[0]) if after else ""
        ok = bool(file_path) and ("failed" not in lowered and "error" not in lowered)
        return BrowserUseDownloadResult(
            status=STATUS_DOWNLOAD_COMPLETED if ok else STATUS_BROWSER_USE_FAILED,
            ok=ok,
            file_path=file_path,
            raw_result=raw,
            metadata={"download_dir": str(target_dir), "pid": os.getpid()},
            error="" if ok else "Browser-Use finished but no new report file was detected",
        )

    def test_toast_login(self, *, download_dir: str | Path | None = None) -> BrowserUseDownloadResult:
        """Open ToastTab with the configured profile and confirm dashboard reachability."""
        if not is_browser_use_enabled({"toast_download": self.config}):
            return BrowserUseDownloadResult(
                status=STATUS_BROWSER_USE_FAILED,
                error="Browser-Use is disabled by config",
            )

        available, reason = self.is_available()
        if not available:
            return BrowserUseDownloadResult(
                status=STATUS_BROWSER_USE_FAILED,
                error=f"browser-use is not installed: {reason}",
            )

        target_dir = Path(download_dir or self.config.get("download_dir") or ".")
        target_dir.mkdir(parents=True, exist_ok=True)
        task_text = (
            "Open https://www.toasttab.com/restaurants/admin/reports using the existing logged-in browser profile.\n"
            "Confirm whether the Toast dashboard or Reports page is reachable.\n"
            "Do not change settings. Do not submit forms except a harmless navigation request.\n"
            "Do not store passwords and do not bypass MFA or CAPTCHA.\n"
            "If login, 2FA, CAPTCHA, permission error, or unclear UI appears, stop and return HUMAN_REQUIRED.\n"
            "If the dashboard or reports page is reachable, return TOAST_DASHBOARD_READY."
        )
        assert_task_is_safe(task_text)

        try:
            raw = asyncio.run(self._run_agent(task_text, target_dir))
        except Exception as exc:
            status = classify_browser_blocker(str(exc))
            return BrowserUseDownloadResult(
                status=status,
                error=str(exc),
                human_required=status == STATUS_HUMAN_REQUIRED,
            )

        status = classify_browser_blocker(raw)
        if status == STATUS_HUMAN_REQUIRED:
            return BrowserUseDownloadResult(
                status=STATUS_HUMAN_REQUIRED,
                raw_result=raw,
                error="Toast login/MFA/CAPTCHA/permission blocker detected",
                human_required=True,
            )
        lowered = raw.lower()
        ok = "toast_dashboard_ready" in lowered or ("dashboard" in lowered and "login" not in lowered)
        return BrowserUseDownloadResult(
            status="TOAST_DASHBOARD_READY" if ok else STATUS_BROWSER_USE_FAILED,
            ok=ok,
            raw_result=raw,
            error="" if ok else "Toast dashboard reachability was not confirmed",
        )
