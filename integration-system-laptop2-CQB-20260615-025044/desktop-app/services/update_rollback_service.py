"""
update_rollback_service.py
If a new version fails to start, rollback to the previous backup.
Restores config/db from the most recent pre-update backup.
Reports rollback result to Mi-core.
"""
from __future__ import annotations

import json
import logging
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DATA_ROOT = Path("C:/ProgramData/ToastPOSManager")
BACKUP_ROOT = DATA_ROOT / "backups"
UPDATE_RESULT_FILE = DATA_ROOT / "runtime" / "update-result.json"


@dataclass
class RollbackResult:
    success: bool
    restored_from: Optional[str]
    files_restored: list
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "success": self.success,
            "restored_from": self.restored_from,
            "files_restored": self.files_restored,
            "error": self.error,
        }


def find_latest_backup(version: str = "", backup_root: Optional[Path] = None) -> Optional[Path]:
    """Find the most recent pre-update backup directory."""
    broot = backup_root or BACKUP_ROOT
    if not broot.exists():
        return None
    pattern = f"pre-update-{version}*" if version else "pre-update-*"
    candidates = sorted(broot.glob(pattern), reverse=True)
    return candidates[0] if candidates else None


def rollback(
    version: str = "",
    backup_path: Optional[Path] = None,
    data_root: Optional[Path] = None,
    mi_core_client=None,
) -> RollbackResult:
    """
    Restore config/db/runtime from the latest backup.
    Does NOT delete the new version binary — just restores data files.
    """
    root = data_root or DATA_ROOT
    src = backup_path or find_latest_backup(version)

    if src is None or not src.exists():
        result = RollbackResult(
            success=False,
            restored_from=str(src) if src else None,
            files_restored=[],
            error="No backup found to rollback from",
        )
        _report_rollback_event(mi_core_client, "UPDATE_ROLLBACK_STARTED", version, result.error)
        return result

    _report_rollback_event(mi_core_client, "UPDATE_ROLLBACK_STARTED", version)

    restored = []
    errors = []

    # Read manifest if available
    manifest_file = src / "backup-manifest.json"
    backed_up_files = []
    if manifest_file.exists():
        try:
            manifest = json.loads(manifest_file.read_text(encoding="utf-8-sig"))
            backed_up_files = manifest.get("files", [])
        except Exception:
            pass

    # Restore each backed-up file
    for rel in backed_up_files:
        if rel.endswith("/"):
            # Directory
            src_dir = src / rel.rstrip("/")
            dst_dir = root / rel.rstrip("/")
            if src_dir.exists():
                try:
                    if dst_dir.exists():
                        shutil.rmtree(dst_dir)
                    shutil.copytree(src_dir, dst_dir)
                    restored.append(rel)
                except Exception as e:
                    errors.append(f"{rel}: {e}")
        else:
            src_file = src / rel
            dst_file = root / rel
            if src_file.exists():
                dst_file.parent.mkdir(parents=True, exist_ok=True)
                try:
                    shutil.copy2(src_file, dst_file)
                    restored.append(rel)
                except Exception as e:
                    errors.append(f"{rel}: {e}")

    success = len(errors) == 0
    error_str = "; ".join(errors) if errors else None

    result = RollbackResult(
        success=success,
        restored_from=str(src),
        files_restored=restored,
        error=error_str,
    )

    event = "UPDATE_ROLLBACK_COMPLETED" if success else "UPDATE_FAILED"
    _report_rollback_event(mi_core_client, event, version, error_str or "")
    logger.info("Rollback %s: %d files restored from %s", "OK" if success else "PARTIAL", len(restored), src)
    return result


def _report_rollback_event(mi_core_client, event_type: str, version: str, error: str = "") -> None:
    if mi_core_client is None:
        return
    try:
        from services.machine_identity_service import get_machine_identity
        machine_id = get_machine_identity()
        mi_core_client.post("/api/integration-agent/update-events", {
            "machine_id": machine_id,
            "event_type": event_type,
            "version": version,
            "error": error,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as e:
        logger.warning("Could not report rollback event %s: %s", event_type, e)
