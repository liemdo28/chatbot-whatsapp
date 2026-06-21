"""Tests for qb_file_scanner.py."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "desktop-app"))


class TestQBFileScanner(unittest.TestCase):
    def setUp(self):
        from services.qb_file_scanner import scan_roots
        self.scan_roots = scan_roots

    def test_finds_qbw_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            qbw = Path(tmp) / "Company.qbw"
            qbw.write_bytes(b"fake qbw")
            results = self.scan_roots(roots=[tmp])
            paths = [r.file_path for r in results]
            self.assertTrue(any("Company.qbw" in p for p in paths))

    def test_finds_qbm_and_qbb(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "Back.qbb").write_bytes(b"backup")
            (Path(tmp) / "Port.qbm").write_bytes(b"portable")
            results = self.scan_roots(roots=[tmp])
            exts = {r.extension for r in results}
            self.assertIn(".qbb", exts)
            self.assertIn(".qbm", exts)

    def test_deduplicates(self):
        with tempfile.TemporaryDirectory() as tmp:
            qbw = Path(tmp) / "Dup.qbw"
            qbw.write_bytes(b"x")
            # Scan same root twice
            results = self.scan_roots(roots=[tmp, tmp])
            matching = [r for r in results if "Dup.qbw" in r.file_path]
            self.assertEqual(len(matching), 1)

    def test_skips_nonexistent_root(self):
        results = self.scan_roots(roots=["Z:\\NonExistentDrive\\Folder"])
        self.assertEqual(results, [])

    def test_skips_windows_system_folder(self):
        from services.qb_file_scanner import _is_excluded
        from pathlib import Path
        self.assertTrue(_is_excluded(Path("C:\\Windows\\System32")))
        self.assertTrue(_is_excluded(Path("C:\\Windows")))

    def test_does_not_skip_normal_folder(self):
        from services.qb_file_scanner import _is_excluded
        self.assertFalse(_is_excluded(Path("C:\\Users\\Bob\\Documents\\QuickBooks")))

    def test_suggested_file_id_is_safe(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "Bakudan Bandera.qbw").write_bytes(b"x")
            results = self.scan_roots(roots=[tmp])
            self.assertTrue(len(results) > 0)
            fid = results[0].suggested_file_id
            self.assertTrue(fid.replace("-", "").isalnum() or "-" in fid)
            self.assertNotIn(" ", fid)


if __name__ == "__main__":
    unittest.main()
