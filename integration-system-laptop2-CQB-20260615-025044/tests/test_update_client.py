"""
tests/test_update_client.py
Tests for update_client.py — version comparison and update check logic.
"""
import json
import sys
import os
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent / "desktop-app"))

from services.update_client import (
    semver_gt, semver_lt, _parse_semver,
    get_local_version, UpdateClient, ReleaseManifest,
    check_for_updates, UpdateCheckResult,
)


# ── Semver tests ──────────────────────────────────────────────────────────────

def test_semver_gt_newer():
    assert semver_gt("1.3.0", "1.2.0") is True

def test_semver_gt_same_is_false():
    assert semver_gt("1.2.0", "1.2.0") is False

def test_semver_lt_older():
    assert semver_lt("1.0.0", "1.2.0") is True

def test_no_update_when_latest_equals_current():
    manifest_data = {
        "app": "integration-system",
        "channel": "stable",
        "version": "1.2.0",
        "build": "20260609.01",
        "published_at": "2026-06-09T09:00:00Z",
        "min_supported_version": "1.0.0",
        "download_url": "http://mi-core/downloads/1.2.0/ToastPOSManagerSetup-1.2.0.exe",
        "sha256": "abc123",
        "size_bytes": 85000000,
        "release_notes": [],
        "requires_restart": True,
        "rollback_supported": True,
    }
    mock_client = MagicMock()
    mock_client.get.return_value = manifest_data

    with patch("services.update_client.get_local_version", return_value="1.2.0"):
        client = UpdateClient(mi_core_client=mock_client)
        result = client.check()

    assert result.update_available is False
    assert result.current_version == "1.2.0"
    assert result.latest_version == "1.2.0"

def test_update_available_when_latest_newer():
    manifest_data = {
        "version": "1.3.0",
        "app": "integration-system",
        "channel": "stable",
        "build": "20260609.02",
        "published_at": "2026-06-09T10:00:00Z",
        "min_supported_version": "1.0.0",
        "download_url": "http://mi-core/downloads/1.3.0/ToastPOSManagerSetup-1.3.0.exe",
        "sha256": "def456",
        "size_bytes": 90000000,
        "release_notes": ["Bug fixes"],
        "requires_restart": True,
        "rollback_supported": True,
    }
    mock_client = MagicMock()
    mock_client.get.return_value = manifest_data

    with patch("services.update_client.get_local_version", return_value="1.2.0"):
        client = UpdateClient(mi_core_client=mock_client)
        result = client.check()

    assert result.update_available is True
    assert result.latest_version == "1.3.0"
    assert result.manifest is not None
    assert result.manifest.download_url.endswith("1.3.0.exe")

def test_reject_invalid_semver():
    from services.update_client import _parse_semver
    import pytest
    try:
        _parse_semver("not-a-version")
        assert False, "Should have raised ValueError"
    except ValueError:
        pass

def test_error_on_mi_core_failure():
    mock_client = MagicMock()
    mock_client.get.side_effect = Exception("Connection refused")

    with patch("services.update_client.get_local_version", return_value="1.2.0"):
        client = UpdateClient(mi_core_client=mock_client)
        result = client.check()

    assert result.update_available is False
    assert result.error is not None
    assert "Connection refused" in result.error

def test_result_to_dict():
    mock_client = MagicMock()
    mock_client.get.return_value = {
        "version": "1.3.0", "app": "integration-system", "channel": "stable",
        "build": "x", "published_at": "2026-01-01T00:00:00Z",
        "min_supported_version": "1.0.0",
        "download_url": "http://mi-core/dl/1.3.0/setup.exe",
        "sha256": "abc", "size_bytes": 1000,
        "release_notes": [], "requires_restart": True, "rollback_supported": True,
    }
    with patch("services.update_client.get_local_version", return_value="1.2.0"):
        result = UpdateClient(mi_core_client=mock_client).check()
    d = result.to_dict()
    assert d["update_available"] is True
    assert d["latest_version"] == "1.3.0"
