from pathlib import Path
import sys
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
DESKTOP_APP = ROOT / "desktop-app"
if str(DESKTOP_APP) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP))


def test_run_download_uses_toast_orchestrator_and_preserves_file_paths(monkeypatch, tmp_path):
    from services import download_reports_service as drs
    from services import toast_download_orchestrator as orchestrator

    calls = []

    monkeypatch.setattr(
        drs,
        "_load_runtime_config",
        lambda: {"toast_download": {"automation_mode": "HYBRID_FALLBACK", "download_dir": str(tmp_path)}},
    )

    def fake_run_toast_download(request, **kwargs):
        calls.append((request.store, request.business_date, request.report_type, bool(kwargs.get("playwright_runner"))))
        return SimpleNamespace(
            ok=True,
            file_path=str(tmp_path / f"{request.store}-{request.business_date}-{request.report_type}.xlsx"),
            error="",
            status="TOAST_REPORT_VALIDATED",
        )

    monkeypatch.setattr(orchestrator, "run_toast_download", fake_run_toast_download)

    result = drs.run_download(
        stores=["Bandera"],
        date_start="2026-06-10",
        date_end="2026-06-10",
        report_types=["sales_summary", "orders"],
    )

    assert result.ok is True
    assert result.success_count == 2
    assert len(result.files) == 2
    assert all(item.file_path.endswith(".xlsx") for item in result.files)
    assert calls == [
        ("Bandera", "2026-06-10", "sales_summary", True),
        ("Bandera", "2026-06-10", "orders", True),
    ]


def test_run_download_surfaces_human_required_as_warning(monkeypatch, tmp_path):
    from services import download_reports_service as drs
    from services import toast_download_orchestrator as orchestrator

    monkeypatch.setattr(
        drs,
        "_load_runtime_config",
        lambda: {"toast_download": {"automation_mode": "HYBRID_FALLBACK", "download_dir": str(tmp_path)}},
    )

    monkeypatch.setattr(
        orchestrator,
        "run_toast_download",
        lambda request, **kwargs: SimpleNamespace(
            ok=False,
            file_path="",
            error="MFA required",
            status="TOAST_HUMAN_REQUIRED",
        ),
    )

    result = drs.run_download(
        stores=["Bandera"],
        date_start="2026-06-10",
        date_end="2026-06-10",
        report_types=["sales_summary"],
    )

    assert result.ok is False
    assert result.fail_count == 1
    assert any("TOAST_HUMAN_REQUIRED" in warning for warning in result.warnings)
    assert "MFA required" in result.files[0].error


def test_run_download_uploads_to_drive_when_configured(monkeypatch, tmp_path):
    from services import download_reports_service as drs
    from services import toast_download_orchestrator as orchestrator

    target_file = tmp_path / "Bandera-2026-06-10-sales_summary.xlsx"
    target_file.write_bytes(b"toast")
    uploads = []

    monkeypatch.setattr(
        drs,
        "_load_runtime_config",
        lambda: {
            "toast_download": {"automation_mode": "HYBRID_FALLBACK", "download_dir": str(tmp_path)},
            "google_drive": {"root_folder_id": "drive-root-123"},
        },
    )

    monkeypatch.setattr(
        orchestrator,
        "run_toast_download",
        lambda request, **kwargs: SimpleNamespace(
            ok=True,
            file_path=str(target_file),
            error="",
            status="TOAST_REPORT_VALIDATED",
        ),
    )

    class FakeDriveService:
        def __init__(self, on_log=None, config=None):
            self.last_auth_status = {"message": ""}

        def authenticate(self):
            return True

        def upload_report(self, local_path, store_name, report_type="sales_summary"):
            uploads.append((local_path, store_name, report_type))
            return "drive-file-123"

    monkeypatch.setitem(__import__("sys").modules, "gdrive_service", type("M", (), {"GDriveService": FakeDriveService}))

    result = drs.run_download(
        stores=["Bandera"],
        date_start="2026-06-10",
        date_end="2026-06-10",
        report_types=["sales_summary"],
    )

    assert result.ok is True
    assert uploads == [(str(target_file), "Bandera", "sales_summary")]
    assert result.files[0].uploaded_to_drive is True


def test_run_playwright_download_request_treats_downloaded_status_as_success(monkeypatch, tmp_path):
    from services import download_reports_service as drs

    target_file = tmp_path / "2026-06-29_SalesSummary_Stockton.xlsx"
    target_file.write_bytes(b"toast")

    class FakeDownloader:
        def __init__(self, **kwargs):
            pass

        def download_reports_daterange(self, **kwargs):
            return {
                "success": 1,
                "fail": 0,
                "total": 1,
                "files": [
                    {
                        "status": "downloaded",
                        "filepath": str(target_file),
                        "filename": target_file.name,
                    }
                ],
            }

    monkeypatch.setitem(__import__("sys").modules, "toast_downloader", type("M", (), {"ToastDownloader": FakeDownloader}))

    result = drs.run_playwright_download_request(
        type("Req", (), {"store": "Stockton", "business_date": "2026-06-29", "report_type": "sales_summary"})()
    )

    assert result.ok is True
    assert result.files[0].success is True
    assert result.files[0].file_path == str(target_file)
