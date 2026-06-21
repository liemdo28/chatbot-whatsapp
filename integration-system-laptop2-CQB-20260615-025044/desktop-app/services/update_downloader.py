"""
update_downloader.py
Downloads integration-system installer from Mi-core to local updates/ dir.
Supports resume, validates file size and SHA-256 checksum.
"""
from __future__ import annotations

import hashlib
import logging
import os
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

UPDATES_DIR = Path("C:/ProgramData/ToastPOSManager/updates")
CHUNK_SIZE = 65536  # 64KB


@dataclass
class DownloadResult:
    success: bool
    file_path: Optional[Path]
    version: str
    size_bytes: int
    sha256_verified: bool
    error: Optional[str] = None


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(CHUNK_SIZE), b""):
            h.update(chunk)
    return h.hexdigest()


def download_update(
    download_url: str,
    version: str,
    expected_sha256: str,
    expected_size_bytes: int = 0,
    updates_dir: Optional[Path] = None,
    _urlopen=None,
) -> DownloadResult:
    """
    Download installer from download_url into updates_dir.
    Validates size and SHA-256 before returning success.
    Supports resume: if partial file exists, sends Range header.
    """
    dest_dir = updates_dir or UPDATES_DIR
    dest_dir.mkdir(parents=True, exist_ok=True)

    filename = f"ToastPOSManagerSetup-{version}.exe"
    dest_path = dest_dir / filename

    opener = _urlopen or urllib.request.urlopen

    # Resume support
    existing_bytes = dest_path.stat().st_size if dest_path.exists() else 0

    try:
        req = urllib.request.Request(download_url)
        if existing_bytes > 0:
            req.add_header("Range", f"bytes={existing_bytes}-")
            logger.info("Resuming download from byte %d", existing_bytes)

        with opener(req, timeout=120) as resp:
            mode = "ab" if existing_bytes > 0 else "wb"
            with open(dest_path, mode) as f:
                while True:
                    chunk = resp.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    f.write(chunk)

    except Exception as e:
        return DownloadResult(
            success=False,
            file_path=dest_path if dest_path.exists() else None,
            version=version,
            size_bytes=dest_path.stat().st_size if dest_path.exists() else 0,
            sha256_verified=False,
            error=f"Download error: {e}",
        )

    actual_size = dest_path.stat().st_size

    # Size validation
    if expected_size_bytes > 0 and actual_size != expected_size_bytes:
        return DownloadResult(
            success=False,
            file_path=dest_path,
            version=version,
            size_bytes=actual_size,
            sha256_verified=False,
            error=f"Size mismatch: expected {expected_size_bytes}, got {actual_size}",
        )

    # SHA-256 validation
    if expected_sha256 and expected_sha256.lower() != "change_me":
        actual_sha256 = _sha256_file(dest_path)
        if actual_sha256.lower() != expected_sha256.lower():
            dest_path.unlink(missing_ok=True)
            return DownloadResult(
                success=False,
                file_path=None,
                version=version,
                size_bytes=actual_size,
                sha256_verified=False,
                error=f"SHA-256 mismatch: expected {expected_sha256}, got {actual_sha256}",
            )
        sha256_ok = True
    else:
        logger.warning("No SHA-256 provided — skipping checksum verification")
        sha256_ok = False

    logger.info("Download complete: %s (%d bytes)", dest_path, actual_size)
    return DownloadResult(
        success=True,
        file_path=dest_path,
        version=version,
        size_bytes=actual_size,
        sha256_verified=sha256_ok,
    )
