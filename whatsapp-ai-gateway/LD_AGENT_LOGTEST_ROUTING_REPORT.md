# LD_AGENT_LOGTEST_ROUTING_REPORT.md
## P0: LD Agent-Logtest Routing Implementation Report
**Date:** 2026-06-19
**Status:** IMPLEMENTATION COMPLETE

---

## 1. Requirement Summary

Route form submissions from WhatsApp groups to the correct store template:

| WhatsApp Group | Store | Template | Field IDs |
|--------------|-------|----------|-----------|
| STORE: THE RIM | B1 / The Rim | FoodSafety-Rim-v3 | RIM-01 to RIM-19 |
| STORE: STONE OAK | B2 / Stone Oak | FoodSafety-StoneOak-v3 | SO-01 to SO-10 |
| STORE: BANDERA | B3 / Bandera | FoodSafety-Bandera-v3 | BAN-01 to BAN-19 |

**Critical:** "THE RIM" form must resolve to RIM-* IDs, NOT IM-* IDs.

---

## 2. Routing Architecture

### Two-Layer Routing

```
Layer 1: WhatsApp Group Name
  "LD Agent-Logtest - The Rim" → The Rim → FoodSafety-Rim-v3
  "B1 Kitchen Log" → The Rim → FoodSafety-Rim-v3
  "Stone Oak Food Safety" → Stone Oak → FoodSafety-StoneOak-v3
  "B2 Kitchen Log" → Stone Oak → FoodSafety-StoneOak-v3
  "B3 Kitchen Log" → Bandera → FoodSafety-Bandera-v3

Layer 2: Form Header OCR (optional override)
  "STORE: THE RIM" → FoodSafety-Rim-v3
  "STORE: STONE OAK" → FoodSafety-StoneOak-v3
  "STORE: BANDERA" → FoodSafety-Bandera-v3
```

---

## 3. Implementation

### `paddleocr_bridge.js` — `resolveTemplateId()`

```javascript
function resolveTemplateId(storeNameOrId) {
    const key = String(storeNameOrId).toLowerCase().trim();

    // Try exact match first
    if (STORE_TEMPLATE_MAP[key]) return STORE_TEMPLATE_MAP[key];

    // Try group name detection
    const detected = detectStoreFromGroupName(key);
    if (detected && STORE_TEMPLATE_MAP[detected]) return STORE_TEMPLATE_MAP[detected];

    // Try partial match
    if (key.includes("rim") && !key.includes("primary")) return "FoodSafety-Rim-v3";
    if (key.includes("stone") && key.includes("oak")) return "FoodSafety-StoneOak-v3";
    if (key.includes("bander")) return "FoodSafety-Bandera-v3";

    return "FoodSafety-StoneOak-v3";  // Safe default
}
```

### `paddleocr_bridge.js` — `detectStoreFromGroupName()`

```javascript
function detectStoreFromGroupName(groupName) {
    const s = String(groupName).toUpperCase();

    if (/\bSTONE\s+OAK\b/.test(s)) return "stone oak";
    if (/\bBANDERA\b/.test(s)) return "bandera";
    if (/\b(THE\s+RIM|RIM)\b/.test(s) && !/PRIM/.test(s)) return "rim";

    // Production group patterns
    if (/\bB1\b/.test(s) && /KITCHEN/.test(s)) return "rim";
    if (/\bB2\b/.test(s) && /KITCHEN/.test(s)) return "stone oak";
    if (/\bB3\b/.test(s) && /KITCHEN/.test(s)) return "bandera";

    return null;
}
```

### `paddleocr_service/form_header_detector.py` — Python equivalent

```python
def detect_store_from_group_name(group_name: str) -> Optional[str]:
    """LD Agent-Logtest routing."""
    s = str(group_name).upper()

    if re.search(r"\bSTONE\s+OAK\b", s): return "STONE OAK"
    if re.search(r"\bBANDERA\b", s): return "BANDERA"
    if re.search(r"\b(THE\s+RIM|RIM)\b", s) and not re.search(r"PRIM", s): return "THE RIM"

    if re.search(r"B1.*KITCHEN|KITCHEN.*B1", s): return "THE RIM"
    if re.search(r"B2.*KITCHEN|KITCHEN.*B2", s): return "STONE OAK"
    if re.search(r"B3.*KITCHEN|KITCHEN.*B3", s): return "BANDERA"

    return None
```

---

## 4. Routing Table

| Input | Detected Store | Template ID | Field Prefix |
|-------|--------------|------------|-------------|
| "STORE: THE RIM" | THE RIM | FoodSafety-Rim-v3 | RIM |
| "STORE: STONE OAK" | STONE OAK | FoodSafety-StoneOak-v3 | SO |
| "STORE: BANDERA" | BANDERA | FoodSafety-Bandera-v3 | BAN |
| "LD Agent-Logtest - The Rim" | THE RIM | FoodSafety-Rim-v3 | RIM |
| "LD Agent-Logtest - Stone Oak" | STONE OAK | FoodSafety-StoneOak-v3 | SO |
| "LD Agent-Logtest - Bandera" | BANDERA | FoodSafety-Bandera-v3 | BAN |
| "B1 Kitchen Log" | THE RIM | FoodSafety-Rim-v3 | RIM |
| "B2 Kitchen Log" | STONE OAK | FoodSafety-StoneOak-v3 | SO |
| "B3 Kitchen Log" | BANDERA | FoodSafety-Bandera-v3 | BAN |
| "the rim" | THE RIM | FoodSafety-Rim-v3 | RIM |
| "RIM" | THE RIM | FoodSafety-Rim-v3 | RIM |
| "stone oak" | STONE OAK | FoodSafety-StoneOak-v3 | SO |
| "B1" | THE RIM | FoodSafety-Rim-v3 | RIM |
| "B2" | STONE OAK | FoodSafety-StoneOak-v3 | SO |
| "B3" | BANDERA | FoodSafety-Bandera-v3 | BAN |
| "rim-02" | THE RIM | FoodSafety-Rim-v3 | RIM |
| "so-07" | STONE OAK | FoodSafety-StoneOak-v3 | SO |
| "ban-19" | BANDERA | FoodSafety-Bandera-v3 | BAN |

---

## 5. Unit Tests

```python
# form_header_detector.py — run_tests()
def run_tests():
    test_cases = [
        ("STORE: THE RIM",      "THE RIM",    "FoodSafety-Rim-v3",       "Explicit rim header"),
        ("STORE: STONE OAK",    "STONE OAK",  "FoodSafety-StoneOak-v3", "Explicit stone oak header"),
        ("STORE: BANDERA",      "BANDERA",    "FoodSafety-Bandera-v3",   "Explicit bandera header"),
        ("LD Agent-Logtest - The Rim",  "THE RIM",    "FoodSafety-Rim-v3",       "Logtest group rim"),
        ("LD Agent-Logtest - Stone Oak","STONE OAK",  "FoodSafety-StoneOak-v3", "Logtest group stone oak"),
        ("B1 Kitchen Log",       "THE RIM",    "FoodSafety-Rim-v3",       "Production B1 group"),
        ("B2 Kitchen Log",       "STONE OAK",  "FoodSafety-StoneOak-v3", "Production B2 group"),
        ("B3 Kitchen Log",       "BANDERA",    "FoodSafety-Bandera-v3",   "Production B3 group"),
        ("The Rim Food Safety",  "THE RIM",    "FoodSafety-Rim-v3",       "Partial rim text"),
    ]
```

---

## 6. Known Anti-Patterns

| Pattern | Should NOT Match | Guard |
|--------|----------------|-------|
| "PRIMARY RIM" | Should not detect as THE RIM | `!/PRIM/.test(s)` in JS, `not re.search(r"PRIM", s)` in Python |
| "PRIM" | Not a store | Word boundary check `\bRIM\b` |
| "RIM-01" | Should match as THE RIM | Partial key match `"rim-01": "FoodSafety-Rim-v3"` |
| "BAN" alone | Should match as BANDERA | `"ban": "FoodSafety-Bandera-v3"` in map |

---

## 7. PASS Criteria

| Criterion | Required | Status |
|-----------|----------|--------|
| STORE: THE RIM → FoodSafety-Rim-v3 | 100% | IMPLEMENTED |
| STORE: STONE OAK → FoodSafety-StoneOak-v3 | 100% | IMPLEMENTED |
| STORE: BANDERA → FoodSafety-Bandera-v3 | 100% | IMPLEMENTED |
| RIM form outputs RIM-* IDs (not IM-*) | 100% | IMPLEMENTED |
| B1 Kitchen Log → The Rim | 100% | IMPLEMENTED |
| B2 Kitchen Log → Stone Oak | 100% | IMPLEMENTED |
| B3 Kitchen Log → Bandera | 100% | IMPLEMENTED |
| "PRIMARY RIM" NOT matched as THE RIM | 100% | IMPLEMENTED |
