"""
qb_file_scanner.py
===================
Scans configured roots for QuickBooks company files (.QBW, .QBM, .QBB).
Never scans Windows system folders. Deduplicates by resolved path.
"""
from __future__ import annotations

import os
import logging
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

logger = logging.getLogger("qb_file_scanner")

QB_EXTENSIONS = {".qbw", ".qbm", ".qbb"}

EXCLUDED_DIRS = {
    "windows", "system32", "syswow64", "program files", "program files (x86)",
    "programdata", "$recycle.bin", "recovery", "boot", "efi",
    "appdata\\local\\temp", "appdata\\locallow", "node_modules",
    ".git", "__pycache__", ".venv", "venv",
}

DEFAULT_SCAN_ROOTS = [
    str(Path.home() / "Documents"),
    str(Path.home() / "Desktop"),
    "D:\\",
    "E:\\",
    "F:\\",
    "G:\\",
]


@dataclass
class FoundQBFile:
    file_path: str
    file_name: str
    extension: str
    size_bytes: int
    drive: str
    suggested_file_id: str
    suggested_store_code: str

    def to_dict(self) -> dict:
        return asdict(self)


def _is_excluded(path: Path) -> bool:
    parts = [p.lower() for p in path.parts]
    for part in parts:
        if part in EXCLUDED_DIRS:
            return True
        for excl in EXCLUDED_DIRS:
            if excl in part and len(part) > 3:
                return True
    return False


def _make_file_id(path: Path) -> str:
    stem = path.stem.lower()
    stem = "".join(c if c.isalnum() else "-" for c in stem).strip("-")
    return stem[:40] or "qb-file"


def scan_roots(roots: Optional[list[str]] = None, max_depth: int = 6) -> list[FoundQBFile]:
    """Scan given roots for QB files. Returns deduplicated list."""
    roots = roots or DEFAULT_SCAN_ROOTS
    found: dict[str, FoundQBFile] = {}  # canonical path → entry

    for root_str in roots:
        root = Path(root_str)
        if not root.exists():
            continue
        logger.info("Scanning %s ...", root)
        try:
            _walk(root, found, 0, max_depth)
        except PermissionError:
            pass
        except Exception as e:
            logger.warning("Scan error in %s: %s", root, e)

    result = sorted(found.values(), key=lambda f: f.file_path)
    logger.info("Found %d QB files across all roots", len(result))
    return result


def _walk(directory: Path, found: dict, depth: int, max_depth: int) -> None:
    if depth > max_depth:
        return
    if _is_excluded(directory):
        return
    try:
        entries = list(directory.iterdir())
    except (PermissionError, OSError):
        return

    for entry in entries:
        if entry.is_file():
            if entry.suffix.lower() in QB_EXTENSIONS:
                canonical = str(entry.resolve())
                if canonical not in found:
                    try:
                        size = entry.stat().st_size
                    except OSError:
                        size = 0
                    drive = entry.drive or "C:"
                    found[canonical] = FoundQBFile(
                        file_path=str(entry),
                        file_name=entry.name,
                        extension=entry.suffix.lower(),
                        size_bytes=size,
                        drive=drive,
                        suggested_file_id=_make_file_id(entry),
                        suggested_store_code=_make_file_id(entry),
                    )
        elif entry.is_dir() and not entry.is_symlink():
            _walk(entry, found, depth + 1, max_depth)
