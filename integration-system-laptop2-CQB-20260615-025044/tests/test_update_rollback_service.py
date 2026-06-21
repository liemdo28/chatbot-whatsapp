"""
tests/test_update_rollback_service.py
Tests for update_rollback_service.py — backup discovery and data restore.
"""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "desktop-app"))

from services.update_rollback_service import rollback, find_latest_backup


def _make_backup(backup_root: Path, version: str, files: dict) -> Path:
    """Create a fake backup directory with given files and manifest."""
    ts = "20260609-090000"
    backup_path = backup_root / f"pre-update-{version}-{ts}"
    backup_path.mkdir(parents=True)

    backed_up = []
    for rel, content in files.items():
        dst = backup_path / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            dst.write_bytes(content)
        else:
            dst.write_text(content, encoding="utf-8")
        backed_up.append(rel)

    manifest = {"version": version, "timestamp": ts, "files": backed_up}
    (backup_path / "backup-manifest.json").write_text(
        json.dumps(manifest), encoding="utf-8"
    )
    return backup_path


def test_rollback_restores_config():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "data"
        backup_root = Path(tmp) / "backups"

        # Original backed-up config
        backup = _make_backup(backup_root, "1.2.0", {
            "config/local-config.json": '{"mi_core": {"base_url": "http://10.0.0.1:4001"}}',
        })

        # Overwrite with bad new-version config
        (root / "config").mkdir(parents=True)
        (root / "config" / "local-config.json").write_text('{"corrupted": true}', encoding="utf-8")

        result = rollback(
            version="1.2.0",
            backup_path=backup,
            data_root=root,
        )

        assert result.success is True
        restored = json.loads((root / "config" / "local-config.json").read_text())
        assert restored.get("mi_core", {}).get("base_url") == "http://10.0.0.1:4001"


def test_rollback_no_backup_returns_failure():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "data"
        backup_root = Path(tmp) / "backups"

        result = rollback(version="1.2.0", backup_path=None, data_root=root)

    assert result.success is False
    assert result.error is not None


def test_find_latest_backup_returns_most_recent():
    with tempfile.TemporaryDirectory() as tmp:
        backup_root = Path(tmp) / "backups"
        _make_backup(backup_root, "1.2.0", {})
        # Make a "later" backup by changing timestamp in name
        later = backup_root / "pre-update-1.3.0-20260609-100000"
        later.mkdir(parents=True)
        (later / "backup-manifest.json").write_text('{"version":"1.3.0","timestamp":"20260609-100000","files":[]}')

        found = find_latest_backup(backup_root=backup_root)

    assert found is not None
    assert "1.3.0" in str(found)


def test_rollback_sends_event_to_mi_core():
    mock_client = __import__("unittest.mock", fromlist=["MagicMock"]).MagicMock()

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "data"
        backup_root = Path(tmp) / "backups"
        backup = _make_backup(backup_root, "1.2.0", {
            "config/local-config.json": '{"ok": true}',
        })
        (root / "config").mkdir(parents=True)
        (root / "config" / "local-config.json").write_text("{}")

        from unittest.mock import patch
        with patch("services.machine_identity_service.get_machine_identity", return_value="qb-laptop-01"):
            result = rollback("1.2.0", backup_path=backup, data_root=root, mi_core_client=mock_client)

    assert result.success is True
    mock_client.post.assert_called()
