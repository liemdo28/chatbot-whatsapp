from __future__ import annotations

from services.toast_browser_agent import STATUS_BROWSER_USE_FAILED
from services.toast_browser_use_downloader import ToastBrowserUseDownloader


def test_config_can_disable_browser_use(tmp_path):
    downloader = ToastBrowserUseDownloader({
        "enabled": True,
        "download_dir": str(tmp_path),
        "browser_use": {"enabled": False},
    })

    result = downloader.download_report(
        store="Bandera",
        business_date="2026-06-10",
        report_type="orders",
        download_dir=tmp_path,
    )

    assert result.status == STATUS_BROWSER_USE_FAILED
    assert "disabled" in result.error.lower()


def test_browser_use_missing_is_controlled_failure(monkeypatch, tmp_path):
    monkeypatch.setattr(ToastBrowserUseDownloader, "is_available", staticmethod(lambda: (False, "not installed")))
    downloader = ToastBrowserUseDownloader({"download_dir": str(tmp_path)})

    result = downloader.download_report(
        store="Bandera",
        business_date="2026-06-10",
        report_type="orders",
        download_dir=tmp_path,
    )

    assert result.status == STATUS_BROWSER_USE_FAILED
    assert "not installed" in result.error


def test_login_check_missing_browser_use_is_controlled_failure(monkeypatch, tmp_path):
    monkeypatch.setattr(ToastBrowserUseDownloader, "is_available", staticmethod(lambda: (False, "not installed")))
    downloader = ToastBrowserUseDownloader({"download_dir": str(tmp_path)})

    result = downloader.test_toast_login(download_dir=tmp_path)

    assert result.status == STATUS_BROWSER_USE_FAILED
    assert "not installed" in result.error
