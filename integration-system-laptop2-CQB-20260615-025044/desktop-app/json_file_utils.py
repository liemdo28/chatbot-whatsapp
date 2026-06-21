"""JSON file helpers that tolerate Windows UTF-8 BOM files."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load_json_file(path: str | Path, *, default: Any = None, missing_ok: bool = False) -> Any:
    """Load JSON as UTF-8, accepting an optional UTF-8 BOM.

    Windows editors can save JSON as "UTF-8 with BOM".  Python's plain
    ``utf-8`` codec leaves that BOM in the first token, which makes
    ``json.load`` fail before the app can start.
    """
    json_path = Path(path)
    if not json_path.exists():
        if missing_ok:
            return default
        raise FileNotFoundError(json_path)

    with open(json_path, "r", encoding="utf-8-sig") as f:
        return json.load(f)
