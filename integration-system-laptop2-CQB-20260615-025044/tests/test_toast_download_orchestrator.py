from __future__ import annotations

from types import SimpleNamespace

from services.toast_browser_agent import (
    AUTOMATION_BROWSER_USE_AGENT,
    AUTOMATION_HYBRID_FALLBACK,
    STATUS_HUMAN_REQUIRED,
    STATUS_REPORT_VALIDATED,
)
from services.toast_download_orchestrator import ToastDownloadRequest, run_toast_download


def _valid_csv(path, store="Bandera", date="2026-06-10"):
    path.write_text(
        "Location,Order ID,Order #,Business Date,Gross Sales,Net Sales\n"
        f"{store},abc,1001,{date},10.00,9.00\n"
        f"{store},def,1002,{date},20.00,18.00\n"
        f"{store},ghi,1003,{date},30.00,27.00\n",
        encoding="utf-8",
    )
    return path


class FakeBrowserUse:
    def __init__(self, result):
        self.calls = 0
        self.result = result

    def download_report(self, **kwargs):
        self.calls += 1
        return self.result


class FakeMiCore:
    def __init__(self):
        self.events = []

    def event(self, event_type, message, event_key="", severity="info", payload=None):
        self.events.append((event_type, payload or {}))
        return True


def test_playwright_success_does_not_call_browser_use(tmp_path):
    report = _valid_csv(tmp_path / "orders_Bandera_2026-06-10.csv")
    fake_browser = FakeBrowserUse({"ok": True, "file_path": str(report), "status": "DOWNLOAD_COMPLETED"})

    def playwright_runner(_request, _download_dir):
        return SimpleNamespace(warnings=[], files=[SimpleNamespace(success=True, file_path=str(report))])

    result = run_toast_download(
        ToastDownloadRequest("Bandera", "2026-06-10", "orders"),
        config={"toast_download": {"automation_mode": AUTOMATION_HYBRID_FALLBACK, "download_dir": str(tmp_path)}},
        playwright_runner=playwright_runner,
        browser_use_downloader=fake_browser,
    )

    assert result.status == STATUS_REPORT_VALIDATED
    assert result.ok is True
    assert fake_browser.calls == 0


def test_playwright_selector_failure_calls_browser_use(tmp_path):
    report = _valid_csv(tmp_path / "orders_Bandera_2026-06-10.csv")
    fake_browser = FakeBrowserUse({"ok": True, "file_path": str(report), "status": "DOWNLOAD_COMPLETED"})

    def playwright_runner(_request, _download_dir):
        return SimpleNamespace(warnings=["selector not found"], files=[])

    result = run_toast_download(
        ToastDownloadRequest("Bandera", "2026-06-10", "orders"),
        config={"toast_download": {"automation_mode": AUTOMATION_HYBRID_FALLBACK, "download_dir": str(tmp_path)}},
        playwright_runner=playwright_runner,
        browser_use_downloader=fake_browser,
    )

    assert fake_browser.calls == 1
    assert result.browser_use_attempted is True
    assert result.status == STATUS_REPORT_VALIDATED


def test_login_required_returns_human_required(tmp_path):
    fake_browser = FakeBrowserUse({"ok": False, "status": STATUS_HUMAN_REQUIRED, "human_required": True, "error": "MFA required"})

    result = run_toast_download(
        ToastDownloadRequest("Bandera", "2026-06-10", "orders"),
        config={"toast_download": {"automation_mode": AUTOMATION_BROWSER_USE_AGENT, "download_dir": str(tmp_path)}},
        browser_use_downloader=fake_browser,
    )

    assert result.status == STATUS_HUMAN_REQUIRED
    assert result.human_required is True


def test_captcha_required_returns_human_required(tmp_path):
    fake_browser = FakeBrowserUse({"ok": False, "status": STATUS_HUMAN_REQUIRED, "human_required": True, "error": "CAPTCHA required"})

    result = run_toast_download(
        ToastDownloadRequest("Bandera", "2026-06-10", "orders"),
        config={"toast_download": {"automation_mode": AUTOMATION_BROWSER_USE_AGENT, "download_dir": str(tmp_path)}},
        browser_use_downloader=fake_browser,
    )

    assert result.status == STATUS_HUMAN_REQUIRED
    assert result.human_required is True


def test_mi_core_event_emitted(tmp_path):
    report = _valid_csv(tmp_path / "orders_Bandera_2026-06-10.csv")
    client = FakeMiCore()

    def playwright_runner(_request, _download_dir):
        return SimpleNamespace(warnings=[], files=[SimpleNamespace(success=True, file_path=str(report))])

    result = run_toast_download(
        ToastDownloadRequest("Bandera", "2026-06-10", "orders"),
        config={"toast_download": {"automation_mode": AUTOMATION_HYBRID_FALLBACK, "download_dir": str(tmp_path)}},
        playwright_runner=playwright_runner,
        mi_core_client=client,
    )

    assert result.ok is True
    assert "TOAST_DOWNLOAD_STARTED" in [event[0] for event in client.events]
    assert "TOAST_REPORT_VALIDATED" in [event[0] for event in client.events]
