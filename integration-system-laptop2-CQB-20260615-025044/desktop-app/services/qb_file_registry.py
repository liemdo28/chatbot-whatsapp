"""
qb_file_registry.py
====================
Manages the list of known QuickBooks company files for this machine.
Persists to local-config.json under 'quickbooks_files.company_files'.
Provides CRUD and status-update operations used by the multi-file sync scheduler.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Optional
from json_file_utils import load_json_file

logger = logging.getLogger("qb_file_registry")

try:
    from app_paths import RUNTIME_DIR
except ImportError:
    RUNTIME_DIR = Path(__file__).resolve().parent.parent

LOCAL_CONFIG_PATH = RUNTIME_DIR / "local-config.json"
_lock = Lock()


@dataclass
class QBFileEntry:
    file_id: str
    store_code: str
    company_file_path: str
    expected_company_name: str = ""
    enabled: bool = True
    last_status: str = ""
    last_synced_at: Optional[str] = None
    next_sync_at: Optional[str] = None
    last_error: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


def _load_config() -> dict:
    if LOCAL_CONFIG_PATH.exists():
        try:
            return load_json_file(LOCAL_CONFIG_PATH)
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def _save_config(config: dict) -> None:
    with open(LOCAL_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)


def get_all_files() -> list[QBFileEntry]:
    with _lock:
        config = _load_config()
        qb_section = config.get("quickbooks_files", {})
        raw = qb_section.get("company_files", [])
        result = []
        for item in raw:
            result.append(QBFileEntry(
                file_id=item.get("file_id", ""),
                store_code=item.get("store_code", ""),
                company_file_path=item.get("company_file_path", ""),
                expected_company_name=item.get("expected_company_name", ""),
                enabled=item.get("enabled", True),
                last_status=item.get("last_status", ""),
                last_synced_at=item.get("last_synced_at"),
                next_sync_at=item.get("next_sync_at"),
                last_error=item.get("last_error", ""),
            ))
        return result


def get_enabled_files() -> list[QBFileEntry]:
    return [f for f in get_all_files() if f.enabled]


def get_file(file_id: str) -> Optional[QBFileEntry]:
    for f in get_all_files():
        if f.file_id == file_id:
            return f
    return None


def upsert_file(entry: QBFileEntry) -> None:
    with _lock:
        config = _load_config()
        qb_section = config.setdefault("quickbooks_files", {})
        files = qb_section.setdefault("company_files", [])
        for i, item in enumerate(files):
            if item.get("file_id") == entry.file_id:
                files[i] = entry.to_dict()
                _save_config(config)
                return
        files.append(entry.to_dict())
        _save_config(config)


def update_file_status(file_id: str, status: str, error: str = "",
                       synced_at: Optional[str] = None,
                       next_sync_at: Optional[str] = None) -> None:
    with _lock:
        config = _load_config()
        files = config.get("quickbooks_files", {}).get("company_files", [])
        for item in files:
            if item.get("file_id") == file_id:
                item["last_status"] = status
                item["last_error"] = error
                if synced_at:
                    item["last_synced_at"] = synced_at
                if next_sync_at:
                    item["next_sync_at"] = next_sync_at
                _save_config(config)
                return
        logger.warning("update_file_status: file_id '%s' not found", file_id)


def enable_file(file_id: str, enabled: bool = True) -> None:
    with _lock:
        config = _load_config()
        for item in config.get("quickbooks_files", {}).get("company_files", []):
            if item.get("file_id") == file_id:
                item["enabled"] = enabled
                _save_config(config)
                return


def remove_file(file_id: str) -> None:
    with _lock:
        config = _load_config()
        qb_section = config.get("quickbooks_files", {})
        files = qb_section.get("company_files", [])
        qb_section["company_files"] = [f for f in files if f.get("file_id") != file_id]
        _save_config(config)


def add_scanned_files(found_files: list) -> int:
    """
    Add newly scanned QB files to registry if not already present.
    Returns count of newly added files.
    """
    existing = {f.file_id for f in get_all_files()}
    added = 0
    for f in found_files:
        fid = f.suggested_file_id if hasattr(f, "suggested_file_id") else f.get("suggested_file_id", "")
        if fid and fid not in existing:
            upsert_file(QBFileEntry(
                file_id=fid,
                store_code=f.suggested_store_code if hasattr(f, "suggested_store_code") else f.get("suggested_store_code", ""),
                company_file_path=f.file_path if hasattr(f, "file_path") else f.get("file_path", ""),
                expected_company_name="",
                enabled=False,  # require user to explicitly enable
            ))
            added += 1
    return added
