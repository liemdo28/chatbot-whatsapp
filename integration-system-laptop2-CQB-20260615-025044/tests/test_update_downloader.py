"""
tests/test_update_downloader.py
Tests for update_downloader.py — download, size check, SHA-256 validation.
"""
import hashlib
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch
from io import BytesIO

sys.path.insert(0, str(Path(__file__).parent.parent / "desktop-app"))

from services.update_downloader import download_update, _sha256_file


def _make_fake_response(data: bytes):
    buf = BytesIO(data)
    mock = MagicMock()
    mock.read.side_effect = lambda n: buf.read(n)
    mock.__enter__ = lambda s: s
    mock.__exit__ = MagicMock(return_value=False)
    return mock


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def test_download_validates_sha256():
    data = b"fake_installer_data_x" * 100
    expected_sha256 = _sha256_bytes(data)

    with tempfile.TemporaryDirectory() as tmpdir:
        updates_dir = Path(tmpdir)

        def fake_urlopen(req, timeout=None):
            return _make_fake_response(data)

        result = download_update(
            download_url="http://mi-core/dl/1.3.0/setup.exe",
            version="1.3.0",
            expected_sha256=expected_sha256,
            expected_size_bytes=len(data),
            updates_dir=updates_dir,
            _urlopen=fake_urlopen,
        )

    assert result.success is True
    assert result.sha256_verified is True
    assert result.size_bytes == len(data)


def test_checksum_mismatch_blocks_install():
    data = b"fake_installer_data" * 100
    wrong_sha256 = "0" * 64

    with tempfile.TemporaryDirectory() as tmpdir:
        updates_dir = Path(tmpdir)

        def fake_urlopen(req, timeout=None):
            return _make_fake_response(data)

        result = download_update(
            download_url="http://mi-core/dl/1.3.0/setup.exe",
            version="1.3.0",
            expected_sha256=wrong_sha256,
            updates_dir=updates_dir,
            _urlopen=fake_urlopen,
        )

    assert result.success is False
    assert result.sha256_verified is False
    assert "SHA-256 mismatch" in (result.error or "")
    # File must be deleted on mismatch
    assert result.file_path is None or not result.file_path.exists()


def test_size_mismatch_fails():
    data = b"x" * 1000
    expected_sha256 = _sha256_bytes(data)

    with tempfile.TemporaryDirectory() as tmpdir:
        updates_dir = Path(tmpdir)

        def fake_urlopen(req, timeout=None):
            return _make_fake_response(data)

        result = download_update(
            download_url="http://mi-core/dl/1.3.0/setup.exe",
            version="1.3.0",
            expected_sha256=expected_sha256,
            expected_size_bytes=9999,  # wrong
            updates_dir=updates_dir,
            _urlopen=fake_urlopen,
        )

    assert result.success is False
    assert "Size mismatch" in (result.error or "")


def test_download_error_returns_failure():
    def fail_urlopen(req, timeout=None):
        raise ConnectionError("Network error")

    with tempfile.TemporaryDirectory() as tmpdir:
        result = download_update(
            download_url="http://mi-core/dl/1.3.0/setup.exe",
            version="1.3.0",
            expected_sha256="abc",
            updates_dir=Path(tmpdir),
            _urlopen=fail_urlopen,
        )

    assert result.success is False
    assert "Network error" in (result.error or "")
