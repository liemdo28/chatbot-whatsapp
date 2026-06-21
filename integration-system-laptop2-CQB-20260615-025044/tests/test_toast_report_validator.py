from __future__ import annotations

from services.toast_report_validator import validate_downloaded_report


def test_downloaded_report_validated(tmp_path):
    path = tmp_path / "orders_Bandera_2026-06-10.csv"
    path.write_text(
        "Location,Order ID,Order #,Business Date,Gross Sales,Net Sales\n"
        "Bandera,abc,1001,2026-06-10,10.00,9.00\n"
        "Bandera,def,1002,2026-06-10,20.00,18.00\n"
        "Bandera,ghi,1003,2026-06-10,30.00,27.00\n",
        encoding="utf-8",
    )

    result = validate_downloaded_report(path, report_type="orders", expected_store="Bandera", expected_date="2026-06-10")

    assert result.ok is True
    assert result.file_size > 0


def test_invalid_report_rejected_when_html_saved_as_csv(tmp_path):
    path = tmp_path / "orders_Bandera_2026-06-10.csv"
    path.write_text("<html><title>Toast Login</title></html>", encoding="utf-8")

    result = validate_downloaded_report(path, report_type="orders", expected_store="Bandera", expected_date="2026-06-10")

    assert result.ok is False
    assert any("HTML" in error for error in result.errors)
