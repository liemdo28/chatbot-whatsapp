"""
update_client.py
Checks Mi-core for new integration-system versions.
Compares semantic versions and returns update availability.
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional
import re
from json_file_utils import load_json_file

logger = logging.getLogger(__name__)

VERSION_FILE = Path(__file__).parent.parent / "version.json"

# ── Semantic version helpers ─────────────────────────────────────────────────

def _parse_semver(v: str) -> tuple[int, int, int]:
    """Parse 'MAJOR.MINOR.PATCH' → (major, minor, patch). Raises ValueError on bad input."""
    m = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", v.strip())
    if not m:
        raise ValueError(f"Invalid semver: {v!r}")
    return int(m.group(1)), int(m.group(2)), int(m.group(3))


def semver_gt(a: str, b: str) -> bool:
    """Return True if version a > version b."""
    return _parse_semver(a) > _parse_semver(b)


def semver_lt(a: str, b: str) -> bool:
    """Return True if version a < version b."""
    return _parse_semver(a) < _parse_semver(b)


# ── Local version ────────────────────────────────────────────────────────────

def get_local_version() -> str:
    """Read version string from version.json. Falls back to '0.0.0'."""
    try:
        data = load_json_file(VERSION_FILE)
        return data.get("version", "0.0.0")
    except Exception as e:
        logger.warning("Could not read version.json: %s", e)
        return "0.0.0"


def get_local_version_info() -> dict:
    """Return full version.json dict. Falls back to defaults."""
    try:
        return load_json_file(VERSION_FILE)
    except Exception:
        return {"app": "integration-system", "version": "0.0.0", "build": "", "channel": "stable"}


# ── Release manifest ─────────────────────────────────────────────────────────

@dataclass
class ReleaseManifest:
    app: str
    channel: str
    version: str
    build: str
    published_at: str
    min_supported_version: str
    download_url: str
    sha256: str
    size_bytes: int
    release_notes: list[str] = field(default_factory=list)
    requires_restart: bool = True
    rollback_supported: bool = True

    @staticmethod
    def from_dict(d: dict) -> "ReleaseManifest":
        return ReleaseManifest(
            app=d.get("app", "integration-system"),
            channel=d.get("channel", "stable"),
            version=d["version"],
            build=d.get("build", ""),
            published_at=d.get("published_at", ""),
            min_supported_version=d.get("min_supported_version", "0.0.0"),
            download_url=d.get("download_url", ""),
            sha256=d.get("sha256", ""),
            size_bytes=int(d.get("size_bytes", 0)),
            release_notes=d.get("release_notes", []),
            requires_restart=bool(d.get("requires_restart", True)),
            rollback_supported=bool(d.get("rollback_supported", True)),
        )


# ── Update check result ──────────────────────────────────────────────────────

@dataclass
class UpdateCheckResult:
    update_available: bool
    current_version: str
    latest_version: Optional[str]
    manifest: Optional[ReleaseManifest]
    error: Optional[str] = None
    checked_at: str = ""

    def to_dict(self) -> dict:
        return {
            "update_available": self.update_available,
            "current_version": self.current_version,
            "latest_version": self.latest_version,
            "error": self.error,
            "checked_at": self.checked_at,
            "manifest": {
                "version": self.manifest.version,
                "download_url": self.manifest.download_url,
                "sha256": self.manifest.sha256,
                "size_bytes": self.manifest.size_bytes,
                "release_notes": self.manifest.release_notes,
            } if self.manifest else None,
        }


# ── Update client ────────────────────────────────────────────────────────────

class UpdateClient:
    """Checks Mi-core for the latest integration-system release."""

    ENDPOINT = "/api/integration-agent/releases/latest"

    def __init__(self, mi_core_client=None):
        self._client = mi_core_client

    def _get_client(self):
        if self._client is not None:
            return self._client
        from services.mi_core_client import get_client
        return get_client()

    def check(self) -> UpdateCheckResult:
        """
        Query Mi-core for the latest release.
        Returns UpdateCheckResult with update_available=True if remote > local.
        """
        from datetime import datetime, timezone
        checked_at = datetime.now(timezone.utc).isoformat()
        current = get_local_version()

        try:
            client = self._get_client()
            resp = client.get(self.ENDPOINT)
            if not resp or resp.get("status") not in (None, "ok") and "version" not in resp:
                # Accept any dict that has 'version'
                if not isinstance(resp, dict) or "version" not in resp:
                    return UpdateCheckResult(
                        update_available=False,
                        current_version=current,
                        latest_version=None,
                        manifest=None,
                        error=f"Bad response: {resp}",
                        checked_at=checked_at,
                    )

            manifest = ReleaseManifest.from_dict(resp)

            try:
                available = semver_gt(manifest.version, current)
            except ValueError as e:
                return UpdateCheckResult(
                    update_available=False,
                    current_version=current,
                    latest_version=manifest.version,
                    manifest=manifest,
                    error=f"Version parse error: {e}",
                    checked_at=checked_at,
                )

            return UpdateCheckResult(
                update_available=available,
                current_version=current,
                latest_version=manifest.version,
                manifest=manifest if available else manifest,
                checked_at=checked_at,
            )

        except Exception as e:
            logger.error("Update check failed: %s", e)
            return UpdateCheckResult(
                update_available=False,
                current_version=current,
                latest_version=None,
                manifest=None,
                error=str(e),
                checked_at=checked_at,
            )


# ── Module-level helpers ─────────────────────────────────────────────────────

_client: Optional[UpdateClient] = None


def get_update_client(mi_core_client=None) -> UpdateClient:
    global _client
    if _client is None or mi_core_client is not None:
        _client = UpdateClient(mi_core_client=mi_core_client)
    return _client


def check_for_updates(mi_core_client=None) -> UpdateCheckResult:
    return get_update_client(mi_core_client).check()
