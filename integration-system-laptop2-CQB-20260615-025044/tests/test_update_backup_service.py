"""
tests/test_update_backup_service.py
Tests for update_backup_service.py — backup creation and manifest.
"""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "desktop-app"))

from services.update_backup_service import create_pre_update_backup, BACKUP_TARGETS


def _make_fake_data_root(tmp: Path) -> Path:
    """Create a fake ProgramData directory with sample config/db files."""
    root = tmp / "ToastPOSManager"
    (root / "config").mkdir(parents=True)
    (root / "runtime").mkdir(parents=True)
    (root / "db").mkdir(parents=True)
    (root / "runtime" / "reporting-outbox").mkdir(parents=True)

    (root / "config" / "local-config.json").write_text('{"mi_core": {}}', encoding="utf-8")
    (root / "config" / "machine-identity.json").write_text('{"machine_id": "qb-laptop-01"}', encoding="utf-8")
    (root / "runtime" / "agent-heartbeat.json").write_text('{"status": "ok"}', encoding="utf-8")
    (root / "db" / "sync-ledger.db").write_bytes(b"\x53\x51\x4c\x69\x74\x65")  # SQLite magic
    return root


def test_backup_includes_config_and_db():
    with tempfile.TemporaryDirectory() as tmp:
        root = _make_fake_data_root(Path(tmp))
        backup_root = Path(tmp) / "backups"

        result = create_pre_update_backup(
            version="1.3.0",
            data_root=root,
            backup_root=backup_root,
        )

    assert result.success is True
    assert result.backup_path is not None
    assert "config/local-config.json" in result.files_backed_up
    assert "config/machine-identity.json" in result.files_backed_up
    assert "db/sync-ledger.db" in result.files_backed_up


def test_backup_creates_manifest():
    with tempfile.TemporaryDirectory() as tmp:
        root = _make_fake_data_root(Path(tmp))
        backup_root = Path(tmp) / "backups"

        result = create_pre_update_backup("1.3.0", data_root=root, backup_root=backup_root)

        manifest_file = result.backup_path / "backup-manifest.json"
        assert manifest_file.exists()
        manifest = json.loads(manifest_file.read_text())
        assert manifest["version"] == "1.3.0"
        assert len(manifest["files"]) > 0


def test_backup_path_contains_version_and_timestamp():
    with tempfile.TemporaryDirectory() as tmp:
        root = _make_fake_data_root(Path(tmp))
        backup_root = Path(tmp) / "backups"

        result = create_pre_update_backup("1.3.0", data_root=root, backup_root=backup_root)

    assert "1.3.0" in str(result.backup_path)
    assert "pre-update" in str(result.backup_path)


def test_backup_succeeds_with_missing_optional_files():
    """Backup should succeed even if some files don't exist (e.g. fresh install)."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "ToastPOSManager"
        root.mkdir()
        # No files at all
        backup_root = Path(tmp) / "backups"

        result = create_pre_update_backup("1.3.0", data_root=root, backup_root=backup_root)

    # Should still succeed — just backs up 0 files
    assert result.success is True
    assert result.error is None
