"""
form_header_detector.py
========================
OCR-based form header / store detection.
Detects STORE: THE RIM / STORE: STONE OAK / STORE: BANDERA
from the top of a food safety form image.

Also supports extracting store from WhatsApp group name for
LD Agent-Logtest routing.

Store → Template mapping:
  THE RIM / RIM / B1 / rim → FoodSafety-Rim-v3 → RIM-*
  STONE OAK / SO / B2 / stone oak → FoodSafety-StoneOak-v3 → SO-*
  BANDERA / BAN / B3 / bandera → FoodSafety-Bandera-v3 → BAN-*
"""

import re
from typing import Optional, Tuple


# ─── Regex patterns for form header detection ────────────────────────────────

HEADER_PATTERNS = [
    # Primary: "STORE: THE RIM" etc.
    re.compile(r"STORE\s*:\s*(THE\s+RIM|RIM)", re.IGNORECASE),
    re.compile(r"STORE\s*:\s*STONE\s+OAK", re.IGNORECASE),
    re.compile(r"STORE\s*:\s*BANDERA", re.IGNORECASE),
    # Fallback: location line
    re.compile(r"LOCATION\s*:\s*(THE\s+RIM|RIM)", re.IGNORECASE),
    re.compile(r"LOCATION\s*:\s*STONE\s+OAK", re.IGNORECASE),
    re.compile(r"LOCATION\s*:\s*BANDERA", re.IGNORECASE),
    # Partial matches (standalone words)
    re.compile(r"\b(THE\s+RIM|RIM|B1)\b", re.IGNORECASE),
    re.compile(r"\bSTONE\s+OAK\b", re.IGNORECASE),
    re.compile(r"\bBANDERA\b", re.IGNORECASE),
]


# ─── Store name normalization ─────────────────────────────────────────────────

def normalize_store_name(raw: str) -> str:
    """Normalize a raw store name to a canonical form."""
    if not raw:
        return ""
    s = raw.strip().upper()
    s = re.sub(r"[^A-Z0-9\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()

    if "RIM" in s:
        return "THE RIM"
    if "STONE" in s and "OAK" in s:
        return "STONE OAK"
    if "BANDERA" in s:
        return "BANDERA"
    if s == "B1":
        return "THE RIM"
    if s == "B2":
        return "STONE OAK"
    if s == "B3":
        return "BANDERA"
    return raw


# ─── Header → store mapping ───────────────────────────────────────────────────

HEADER_STORE_MAP = {
    "THE RIM":    {"template": "FoodSafety-Rim-v3",      "group": "B1", "code": "RIM"},
    "STONE OAK":  {"template": "FoodSafety-StoneOak-v3", "group": "B2", "code": "SO"},
    "BANDERA":    {"template": "FoodSafety-Bandera-v3",   "group": "B3", "code": "BAN"},
}


# ─── Group name → store (LD Agent-Logtest routing) ───────────────────────────

GROUP_NAME_PATTERNS = [
    (re.compile(r"THE\s+RIM|RIM\b", re.IGNORECASE),  "THE RIM"),
    (re.compile(r"STONE\s+OAK", re.IGNORECASE),        "STONE OAK"),
    (re.compile(r"BANDERA\b", re.IGNORECASE),           "BANDERA"),
]


def detect_store_from_group_name(group_name: str) -> Optional[str]:
    """
    LD Agent-Logtest routing:
      STORE: THE RIM → B1 / RIM-*
      STORE: STONE OAK → B2 / SO-*
      STORE: BANDERA → B3 / BAN-*

    Also supports:
      "LD Agent-Logtest - The Rim" → B1 / RIM-*
      "B1 Kitchen Log" → B1 / RIM-*
      "B2 Kitchen Log" → B2 / SO-*
      "B3 Kitchen Log" → B3 / BAN-*
    """
    if not group_name:
        return None
    s = str(group_name).upper()

    # Check explicit store name patterns
    for pattern, store in GROUP_NAME_PATTERNS:
        if pattern.search(s):
            return store

    # Check group ID patterns
    if re.search(r"B1.*KITCHEN|KITCHEN.*B1", s):
        return "THE RIM"
    if re.search(r"B2.*KITCHEN|KITCHEN.*B2", s):
        return "STONE OAK"
    if re.search(r"B3.*KITCHEN|KITCHEN.*B3", s):
        return "BANDERA"

    # Check production group names
    if re.search(r"\bRIM\b", s):
        return "THE RIM"

    return None


# ─── Form header text extraction ─────────────────────────────────────────────

def detect_store_from_text(text: str) -> Optional[str]:
    """
    Given raw OCR text from the top of a form, detect which store it belongs to.

    Returns canonical store name or None.
    """
    if not text:
        return None
    upper = text.upper()

    # Priority: explicit STORE: X header
    if re.search(r"STORE\s*:\s*(THE\s+RIM|RIM)\b", upper):
        return "THE RIM"
    if re.search(r"STORE\s*:\s*STONE\s+OAK\b", upper):
        return "STONE OAK"
    if re.search(r"STORE\s*:\s*BANDERA\b", upper):
        return "BANDERA"

    # Then location headers
    if re.search(r"LOCATION\s*:\s*(THE\s+RIM|RIM)\b", upper):
        return "THE RIM"
    if re.search(r"LOCATION\s*:\s*STONE\s+OAK\b", upper):
        return "STONE OAK"
    if re.search(r"LOCATION\s*:\s*BANDERA\b", upper):
        return "BANDERA"

    # Then standalone word matches
    if re.search(r"\bSTONE\s+OAK\b", upper):
        return "STONE OAK"
    if re.search(r"\bBANDERA\b", upper):
        return "BANDERA"
    if re.search(r"\b(THE\s+RIM|RIM)\b", upper):
        # Be careful: "PRIMARY" contains "RIM" — require word boundary
        if re.search(r"\bRIM\b", upper) and not upper.startswith("PRIM"):
            return "THE RIM"

    return None


def resolve_template_from_store(store_name: str) -> str:
    """Map canonical store name → template ID."""
    info = HEADER_STORE_MAP.get(normalize_store_name(store_name))
    if info:
        return info["template"]
    return "FoodSafety-StoneOak-v3"  # Safe default


def resolve_store_info(store_name: str) -> dict:
    """Return full store info dict."""
    info = HEADER_STORE_MAP.get(normalize_store_name(store_name))
    if info:
        return {
            "store_name": normalize_store_name(store_name),
            "template_id": info["template"],
            "store_group": info["group"],
            "field_prefix": info["code"],
        }
    return {
        "store_name": "Unknown",
        "template_id": "FoodSafety-StoneOak-v3",
        "store_group": "B2",
        "field_prefix": "SO",
    }


# ─── Combined routing for LD Agent-Logtest ───────────────────────────────────

def route_submission(store_or_group: str) -> dict:
    """
    Route a form submission based on store name or WhatsApp group name.

    For LD Agent-Logtest:
      STORE: THE RIM → B1 / RIM-*
      STORE: STONE OAK → B2 / SO-*
      STORE: BANDERA → B3 / BAN-*

    For production groups:
      B1 Kitchen Log → The Rim → RIM-*
      B2 Kitchen Log → Stone Oak → SO-*
      B3 Kitchen Log → Bandera → BAN-*

    Returns:
        { store_name, template_id, store_group, field_prefix, routing_source }
    """
    # Try store name detection first
    store = detect_store_from_text(store_or_group)
    routing_source = "form_header"

    # Fall back to group name detection
    if not store:
        store = detect_store_from_group_name(store_or_group)
        routing_source = "group_name"

    if not store:
        routing_source = "default_b2"
        store = "STONE OAK"

    info = resolve_store_info(store)
    info["routing_source"] = routing_source
    return info


# ─── Unit tests ──────────────────────────────────────────────────────────────

def run_tests():
    """P0 unit tests for form header detection."""
    print("[P0] Form Header Detection Tests")
    print("=" * 60)

    test_cases = [
        # (input, expected_store, expected_template, description)
        ("STORE: THE RIM",      "THE RIM",    "FoodSafety-Rim-v3",       "Explicit rim header"),
        ("STORE: STONE OAK",    "STONE OAK",  "FoodSafety-StoneOak-v3", "Explicit stone oak header"),
        ("STORE: BANDERA",      "BANDERA",    "FoodSafety-Bandera-v3",   "Explicit bandera header"),
        ("LOCATION: THE RIM",   "THE RIM",    "FoodSafety-Rim-v3",       "Location rim header"),
        ("STORE: rim",          "THE RIM",    "FoodSafety-Rim-v3",       "Lowercase rim"),
        ("STORE: Stone Oak",    "STONE OAK",  "FoodSafety-StoneOak-v3", "Mixed case stone oak"),
        ("LD Agent-Logtest - The Rim",  "THE RIM",    "FoodSafety-Rim-v3",       "Logtest group rim"),
        ("LD Agent-Logtest - Stone Oak","STONE OAK",  "FoodSafety-StoneOak-v3", "Logtest group stone oak"),
        ("B1 Kitchen Log",       "THE RIM",    "FoodSafety-Rim-v3",       "Production B1 group"),
        ("B2 Kitchen Log",       "STONE OAK",  "FoodSafety-StoneOak-v3", "Production B2 group"),
        ("B3 Kitchen Log",       "BANDERA",    "FoodSafety-Bandera-v3",   "Production B3 group"),
        ("The Rim Food Safety",  "THE RIM",    "FoodSafety-Rim-v3",       "Partial rim text"),
        ("Stone Oak Form",       "STONE OAK",  "FoodSafety-StoneOak-v3", "Partial stone oak text"),
    ]

    all_passed = True
    for input_text, expected_store, expected_template, desc in test_cases:
        result = route_submission(input_text)
        ok_store = result["store_name"] == expected_store
        ok_tmpl = result["template_id"] == expected_template
        ok = ok_store and ok_tmpl
        status = "PASS" if ok else "FAIL"
        print(f"  [{status}] {desc}")
        print(f"         input='{input_text}'")
        print(f"         store={result['store_name']} (expected {expected_store}), "
              f"template={result['template_id']} (expected {expected_template})")
        if not ok:
            all_passed = False
    print("")
    overall = "ALL PASS" if all_passed else "SOME FAILURES"
    print(f"Form Header Detection: {overall}")
    return all_passed


if __name__ == "__main__":
    run_tests()
