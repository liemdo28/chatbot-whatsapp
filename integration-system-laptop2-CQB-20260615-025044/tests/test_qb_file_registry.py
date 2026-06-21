"""Tests for qb_file_registry.py."""
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "desktop-app"))

from services.qb_file_registry import QBFileEntry


def _config_with_files(files):
    return {"quickbooks_files": {"company_files": [f.to_dict() for f in files]}}


def _bandera():
    return QBFileEntry(
        file_id="bandera", store_code="bandera",
        company_file_path="D:\\QB\\Bandera.qbw",
        expected_company_name="Bakudan Bandera", enabled=True,
    )


class TestQBFileRegistry(unittest.TestCase):
    def test_get_all_returns_entries(self):
        config = _config_with_files([_bandera()])
        with patch("services.qb_file_registry._load_config", return_value=config), \
             patch("services.qb_file_registry._save_config"):
            import services.qb_file_registry as reg
            files = reg.get_all_files()
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].file_id, "bandera")

    def test_get_enabled_filters_disabled(self):
        disabled = QBFileEntry("x", "x", "D:\\x.qbw", enabled=False)
        config = _config_with_files([_bandera(), disabled])
        with patch("services.qb_file_registry._load_config", return_value=config), \
             patch("services.qb_file_registry._save_config"):
            import services.qb_file_registry as reg
            enabled = reg.get_enabled_files()
        self.assertEqual(len(enabled), 1)
        self.assertEqual(enabled[0].file_id, "bandera")

    def test_upsert_adds_new_file(self):
        saved = [None]
        config = _config_with_files([_bandera()])

        def fake_load():
            return json.loads(json.dumps(config))  # deep copy

        def fake_save(c):
            saved[0] = c

        with patch("services.qb_file_registry._load_config", side_effect=fake_load), \
             patch("services.qb_file_registry._save_config", side_effect=fake_save):
            import services.qb_file_registry as reg
            reg.upsert_file(QBFileEntry("stoneoak", "stone_oak", "D:\\SO.qbw"))

        files = saved[0]["quickbooks_files"]["company_files"]
        self.assertEqual(len(files), 2)
        self.assertIn("stoneoak", [f["file_id"] for f in files])

    def test_update_status(self):
        saved = [None]
        config = _config_with_files([_bandera()])

        def fake_load():
            return json.loads(json.dumps(config))

        def fake_save(c):
            saved[0] = c

        with patch("services.qb_file_registry._load_config", side_effect=fake_load), \
             patch("services.qb_file_registry._save_config", side_effect=fake_save):
            import services.qb_file_registry as reg
            reg.update_file_status("bandera", "PASS", synced_at="2026-06-09T09:00:00Z")

        items = saved[0]["quickbooks_files"]["company_files"]
        bandera = next(i for i in items if i["file_id"] == "bandera")
        self.assertEqual(bandera["last_status"], "PASS")
        self.assertEqual(bandera["last_synced_at"], "2026-06-09T09:00:00Z")

    def test_enable_disable(self):
        calls = []

        def fake_load():
            return _config_with_files([_bandera()])

        def fake_save(c):
            calls.append(c)

        with patch("services.qb_file_registry._load_config", side_effect=fake_load), \
             patch("services.qb_file_registry._save_config", side_effect=fake_save):
            import services.qb_file_registry as reg
            reg.enable_file("bandera", False)

        last = calls[-1]["quickbooks_files"]["company_files"][0]
        self.assertFalse(last["enabled"])

    def test_remove_file(self):
        saved = [None]

        def fake_load():
            return _config_with_files([_bandera()])

        def fake_save(c):
            saved[0] = c

        with patch("services.qb_file_registry._load_config", side_effect=fake_load), \
             patch("services.qb_file_registry._save_config", side_effect=fake_save):
            import services.qb_file_registry as reg
            reg.remove_file("bandera")

        self.assertEqual(len(saved[0]["quickbooks_files"]["company_files"]), 0)


if __name__ == "__main__":
    unittest.main()
