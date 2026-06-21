"""
update_backup_service.py
Creates a pre-update backup of config, db, runtime state, and log index
before installing a new version. Backup lives in:
  C:\\ProgramData\\ToastPOSManager\\backups\\pre-update-<version>-<timestamp>\\
"""
from __future__ import annotations

import json
import logging
import shutil
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DATA_ROOT = Path("C:/ProgramData/ToastPOSManager")
BACKUP_ROOT = DATA_ROOT / "backups"

# Paths relative to DATA_ROOT that we always backup
BACKUP_TARGETS = [
    "config/local-config.json",
    "config/machine-identity.json",
    "runtime/agent-heartbeat.json",
    "runtime/scheduler-state.json",
    "db/sync-ledger.db",
    "db/qb-agent.db",
]

# Dirs to backup entirely (we take a snapshot, not full copy)
BACKUP_DIRS = [
    "runtime/reporting-outbox",
]


@dataclass
class BackupResult:
    success: bool
    backup_path: Optional[Path]
    version: str
    files_backed_up: list[str] = field(default_factory=list)
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "success": self.success,
            "backup_path": str(self.backup_path) if self.backup_path else None,
            "version": self.version,
            "files_backed_up": self.files_backed_up,
            "error": self.error,
        }


def create_pre_update_backup(
    version: str,
    data_root: Optional[Path] = None,
    backup_root: Optional[Path] = None,
) -> BackupResult:
    """
    Snapshot all user data before installing version.
    Returns BackupResult. On failure, does NOT raise — caller decides how to handle.
    """
    root = data_root or DATA_ROOT
    broot = backup_root or BACKUP_ROOT
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup_path = broot / f"pre-update-{version}-{ts}"

    try:
        backup_path.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        return BackupResult(
            success=False,
            backup_path=None,
            version=version,
            error=f"Cannot create backup dir: {e}",
        )

    backed_up = []

    # Copy individual files
    for rel in BACKUP_TARGETS:
        src = root / rel
        if src.exists():
            dst = backup_path / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            try:
                shutil.copy2(src, dst)
                backed_up.append(rel)
            except Exception as e:
                logger.warning("Could not backup %s: %s", rel, e)

    # Copy dirs
    for rel_dir in BACKUP_DIRS:
        src_dir = root / rel_dir
        if src_dir.exists():
            dst_dir = backup_path / rel_dir
            try:
                shutil.copytree(src_dir, dst_dir, dirs_exist_ok=True)
                backed_up.append(rel_dir + "/")
            except Exception as e:
                logger.warning("Could not backup dir %s: %s", rel_dir, e)

    # Write backup manifest
    manifest = {
        "version": version,
        "timestamp": ts,
        "files": backed_up,
    }
    try:
        (backup_path / "backup-manifest.json").write_text(
            json.dumps(manifest, indent=2), encoding="utf-8"
        )
    except Exception as e:
        logger.warning("Could not write backup manifest: %s", e)

    logger.info("Pre-update backup created at %s (%d items)", backup_path, len(backed_up))
    return BackupResult(
        success=True,
        backup_path=backup_path,
        version=version,
        files_backed_up=backed_up,
    )
