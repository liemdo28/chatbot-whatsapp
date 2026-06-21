from __future__ import annotations

import json

import pytest

from bootstrap_runtime import BootstrapReport, _ensure_config_files
from json_file_utils import load_json_file


def test_load_json_file_accepts_plain_utf8(tmp_path):
    path = tmp_path / "local-config.json"
    path.write_text(json.dumps({"mi_core": {"enabled": True}}), encoding="utf-8")

    assert load_json_file(path)["mi_core"]["enabled"] is True


def test_load_json_file_accepts_utf8_bom(tmp_path):
    path = tmp_path / "local-config.json"
    path.write_text(json.dumps({"machine": {"machine_id": "qb-laptop-01"}}), encoding="utf-8-sig")

    assert load_json_file(path)["machine"]["machine_id"] == "qb-laptop-01"


def test_load_json_file_missing_can_warn_via_default(tmp_path):
    path = tmp_path / "missing-config.json"

    assert load_json_file(path, missing_ok=True, default={}) == {}


def test_load_json_file_empty_config_is_error_not_bom_crash(tmp_path):
    path = tmp_path / "local-config.json"
    path.write_text("", encoding="utf-8")

    with pytest.raises(json.JSONDecodeError):
        load_json_file(path)


def test_load_json_file_corrupted_config_is_error_not_bom_crash(tmp_path):
    path = tmp_path / "local-config.json"
    path.write_text("{not-json", encoding="utf-8")

    with pytest.raises(json.JSONDecodeError):
        load_json_file(path)


def test_bootstrap_accepts_bom_local_config(monkeypatch, tmp_path):
    example = tmp_path / "local-config.example.json"
    example.write_text(json.dumps({"mi_core": {"enabled": False}}), encoding="utf-8")
    (tmp_path / ".env.qb.example").write_text("QB_PASSWORD1=\n", encoding="utf-8")
    (tmp_path / ".env.qb").write_text("QB_PASSWORD1=secret\n", encoding="utf-8")
    config = tmp_path / "local-config.json"
    config.write_text(json.dumps({"mi_core": {"enabled": True}}), encoding="utf-8-sig")

    import bootstrap_runtime

    monkeypatch.setattr(bootstrap_runtime, "APP_DIR", tmp_path)
    monkeypatch.setattr(bootstrap_runtime, "RUNTIME_DIR", tmp_path)
    report = BootstrapReport(can_run=True, is_first_run=False, portable_mode=False)

    _ensure_config_files(report)

    messages = "\n".join(item.message for item in report.items)
    assert "Malformed config" not in messages
    assert any(item.name == "local-config.json" and item.status == "ok" for item in report.items)
