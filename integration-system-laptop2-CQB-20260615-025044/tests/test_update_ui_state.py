"""
tests/test_update_ui_state.py
Tests for update UI state — version display, banner state, result file reading.
"""
import json
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent / "desktop-app"))


def test_get_local_version_reads_version_json():
    fake_version = {"app": "integration-system", "version": "1.2.0", "build": "20260609.01", "channel": "stable"}
    with tempfile.TemporaryDirectory() as tmp:
        vf = Path(tmp) / "version.json"
        vf.write_text(json.dumps(fake_version), encoding="utf-8")

        from services import update_client
        with patch.object(update_client, "VERSION_FILE", vf):
            v = update_client.get_local_version()

    assert v == "1.2.0"


def test_get_local_version_fallback():
    with tempfile.TemporaryDirectory() as tmp:
        vf = Path(tmp) / "version.json"
        # File doesn't exist

        from services import update_client
        with patch.object(update_client, "VERSION_FILE", vf):
            v = update_client.get_local_version()

    assert v == "0.0.0"


def test_get_local_version_info_returns_dict():
    fake_version = {"app": "integration-system", "version": "1.2.0", "build": "20260609.01", "channel": "stable"}
    with tempfile.TemporaryDirectory() as tmp:
        vf = Path(tmp) / "version.json"
        vf.write_text(json.dumps(fake_version), encoding="utf-8")

        from services import update_client
        with patch.object(update_client, "VERSION_FILE", vf):
            info = update_client.get_local_version_info()

    assert info["version"] == "1.2.0"
    assert info["build"] == "20260609.01"
    assert info["channel"] == "stable"


def test_update_result_file_can_be_read():
    result_data = {
        "success": True,
        "version": "1.3.0",
        "installer_path": "C:/ProgramData/ToastPOSManager/updates/setup.exe",
        "backup_path": "C:/ProgramData/ToastPOSManager/backups/pre-update-1.3.0-20260609",
        "error": None,
        "timestamp": "2026-06-09T10:00:00Z",
    }
    with tempfile.TemporaryDirectory() as tmp:
        result_file = Path(tmp) / "update-result.json"
        result_file.write_text(json.dumps(result_data), encoding="utf-8")

        loaded = json.loads(result_file.read_text())

    assert loaded["success"] is True
    assert loaded["version"] == "1.3.0"
