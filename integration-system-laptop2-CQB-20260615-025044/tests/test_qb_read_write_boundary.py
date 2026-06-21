"""
test_qb_read_write_boundary.py
================================
Proves that activity log / timeline / reporting code paths NEVER call
QB write QBXML tags (AddRq, ModRq, DelRq, TxnDel, etc.).

Write tags are ONLY allowed in:
  - desktop-app/qb_sync.py
  - desktop-app/qb_client.py

They must NOT appear in:
  - desktop-app/services/qb_activity_log_service.py
  - desktop-app/services/qb_activity_queries.py
  - desktop-app/services/qb_activity_timeline_queries.py
  - desktop-app/services/qb_activity_timeline_service.py
  - desktop-app/services/qb_file_sync_runner.py
  - desktop-app/services/qb_multi_file_sync_scheduler.py
  - desktop-app/services/mi_core_client.py
  - desktop-app/services/remote_command_client.py
"""
import re
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DESKTOP_APP = REPO_ROOT / "desktop-app"

# QBXML write patterns that must NOT appear in read-only files
WRITE_PATTERNS = re.compile(
    r"AddRq|ModRq|DelRq|TxnDel|TxnMod|SalesReceiptAdd|CustomerAdd|"
    r"DepositAdd|JournalEntryAdd|BillAdd|CheckAdd|CreditCardChargeAdd|"
    r"ItemServiceAdd|ItemNonInventoryAdd",
    re.IGNORECASE,
)

# Files that must remain purely read-only
READ_ONLY_FILES = [
    "services/qb_activity_log_service.py",
    "services/qb_activity_queries.py",
    "services/qb_activity_timeline_queries.py",
    "services/qb_activity_timeline_service.py",
    "services/qb_file_sync_runner.py",
    "services/qb_multi_file_sync_scheduler.py",
    "services/mi_core_client.py",
    "services/remote_command_client.py",
    "services/qb_file_registry.py",
    "services/qb_file_scanner.py",
    "services/reporting_outbox.py",
    "services/machine_identity_service.py",
]

# Files where write tags ARE expected/allowed
WRITE_ALLOWED_FILES = [
    "qb_sync.py",
    "qb_client.py",
]


class TestQBReadWriteBoundary(unittest.TestCase):

    def _check_no_write_tags(self, rel_path: str):
        full = DESKTOP_APP / rel_path
        if not full.exists():
            self.skipTest(f"File does not exist: {full}")
        content = full.read_text(encoding="utf-8", errors="replace")
        matches = WRITE_PATTERNS.findall(content)
        self.assertEqual(
            matches, [],
            f"QB WRITE tag found in read-only file {rel_path}: {matches[:5]}"
        )

    def _check_has_write_tags(self, rel_path: str):
        full = DESKTOP_APP / rel_path
        if not full.exists():
            self.skipTest(f"File does not exist: {full}")
        content = full.read_text(encoding="utf-8", errors="replace")
        matches = WRITE_PATTERNS.findall(content)
        self.assertGreater(
            len(matches), 0,
            f"Expected QB write tags in {rel_path} but none found"
        )


# Dynamically generate test methods for each read-only file
def _make_readonly_test(path):
    def test_fn(self):
        self._check_no_write_tags(path)
    test_fn.__name__ = f"test_no_write_tags__{path.replace('/', '_').replace('.', '_')}"
    return test_fn


for _path in READ_ONLY_FILES:
    _fn = _make_readonly_test(_path)
    setattr(TestQBReadWriteBoundary, _fn.__name__, _fn)


class TestQBWriteFilesHaveWriteTags(unittest.TestCase):
    """Confirm that the write-allowed files do have write tags (sanity check)."""

    def test_qb_sync_has_write_tags(self):
        f = DESKTOP_APP / "qb_sync.py"
        if not f.exists():
            self.skipTest("qb_sync.py not found")
        content = f.read_text(encoding="utf-8", errors="replace")
        self.assertTrue(WRITE_PATTERNS.search(content), "Expected write tags in qb_sync.py")

    def test_qb_client_has_delete_method(self):
        f = DESKTOP_APP / "qb_client.py"
        if not f.exists():
            self.skipTest("qb_client.py not found")
        content = f.read_text(encoding="utf-8", errors="replace")
        self.assertIn("delete_transaction", content)


if __name__ == "__main__":
    unittest.main()
