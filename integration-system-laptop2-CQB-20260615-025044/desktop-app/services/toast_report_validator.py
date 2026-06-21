"""Validation layer for Toast downloads before any QB sync."""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from report_validator import validate_toast_report_file


MIN_REPORT_SIZE_BYTES = 128


@dataclass
class ToastReportValidation:
    ok: bool
    path: str
    file_size: int = 0
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "path": self.path,
            "file_size": self.file_size,
            "errors": list(self.errors),
            "warnings": list(self.warnings),
            "details": dict(self.details),
        }


def _looks_like_html(path: Path) -> bool:
    try:
        head = path.read_bytes()[:512].decode("utf-8", errors="ignore").lower()
    except Exception:
        return False
    return "<html" in head or "<!doctype html" in head or "toast login" in head


def _csv_text_sample(path: Path) -> str:
    try:
        with open(path, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.reader(f)
            rows = []
            for _ in range(10):
                try:
                    rows.append(",".join(next(reader)))
                except StopIteration:
                    break
        return "\n".join(rows).lower()
    except Exception:
        return ""


def validate_downloaded_report(
    path: str | Path,
    *,
    report_type: str,
    expected_store: str = "",
    expected_date: str = "",
    minimum_size_bytes: int = MIN_REPORT_SIZE_BYTES,
) -> ToastReportValidation:
    report_path = Path(path)
    errors: list[str] = []
    warnings: list[str] = []
    details: dict[str, Any] = {}

    if not report_path.exists():
        return ToastReportValidation(False, str(report_path), errors=["File does not exist"])

    file_size = report_path.stat().st_size
    if file_size < minimum_size_bytes:
        errors.append(f"File is too small: {file_size} bytes")
    if _looks_like_html(report_path):
        errors.append("Downloaded file appears to be an HTML/login/error page")

    try:
        base_validation = validate_toast_report_file(report_path, report_type)
        details["base_validation"] = base_validation.to_dict()
        if not base_validation.ok:
            errors.extend(base_validation.errors)
        warnings.extend(base_validation.warnings)
    except Exception as exc:
        errors.append(f"Base report validation failed: {exc}")

    sample = _csv_text_sample(report_path) if report_path.suffix.lower() == ".csv" else report_path.name.lower()
    if expected_store and expected_store.lower().replace("_", " ") not in sample:
        warnings.append("Expected store was not found in the report sample or filename")
    if expected_date and expected_date not in sample and expected_date.replace("-", "") not in sample:
        warnings.append("Expected date was not found in the report sample or filename")

    return ToastReportValidation(
        ok=not errors,
        path=str(report_path),
        file_size=file_size,
        errors=errors,
        warnings=warnings,
        details=details,
    )
