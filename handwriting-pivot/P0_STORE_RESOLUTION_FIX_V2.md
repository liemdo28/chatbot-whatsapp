# P0 STORE RESOLUTION FIX V2 — Runtime Proof

## Status: FIXED — ALL 99 TESTS GREEN

Date: 2026-06-21
Severity: P0 CRITICAL BLOCKER
Trace: FS-20260621-075009-468F

## 1. Root Cause

The Python vision LLM pipeline had a 2-level store resolution:
1. Group name → schema
2. Header text → schema

When BOTH failed (group not in `GROUP_TO_SCHEMA` map AND header text didn't match known store names), the pipeline returned `store_unresolved` and discarded the submission.

**The missing levels were:**
3. Template Signature Detection (field ID patterns: RIM-xx, SO-xx, BAN-xx)
4. Manual Confirmation (ask user — never discard)

## 2. Required Resolution Order (implemented)

```
Level 1: Group Mapping (authoritative)
  B1 Kitchen Log → The Rim
  B2 Kitchen Log → Stone Oak
  B3 Kitchen Log → Bandera

Level 2: Header Detection
  Vision LLM reads "THE RIM" / "STONE OAK" / "BANDERA" from form header

Level 3: Template Signature Detection
  Field IDs starting with RIM-xx → The Rim
  Field IDs starting with SO-xx  → Stone Oak
  Field IDs starting with BAN-xx → Bandera

Level 4: Manual Confirmation
  Reply: "Need store confirmation: 1=B1/The Rim, 2=B2/Stone Oak, 3=B3/Bandera"
  NEVER discard submission. NEVER silently fail.
```

## 3. Files Changed

### handwriting-pivot/code/schemas/stores.py
- Refactored `resolve_store()` to implement Level 1 (group) → Level 2 (header) order
- Added `resolve_store_from_field_ids()` for Level 3 (template signature detection)
- Minimum 2 matching field IDs required for confidence

### handwriting-pivot/code/pipeline.py
- Added Level 3: When group + header fail, tries field ID pattern matching
- Added Level 4: When all levels fail, returns manual confirmation prompt instead of error
- Reply format: "Need store confirmation: 1=B1/The Rim 2=B2/Stone Oak 3=B3/Bandera"
- Never discards submission — always returns trace_id for audit trail

### handwriting-pivot/server.py
- Added `store_resolution_source` field to response JSON:
  - `"group_mapping"` when store resolved from group
  - `"manual_confirmation_needed"` when asking user
  - `"unresolved"` should never appear after fix

### handwriting-pivot/tests/test_store_resolution_proof.py (NEW)
- 26 tests covering all 4 resolution levels
- End-to-end pipeline tests for all 3 stores
- Manual confirmation path verification
- Submission-never-discarded assertion

### handwriting-pivot/tests/test_p0_fixes.py
- Updated `test_unknown_group_with_unknown_header_returns_error` → now expects manual confirmation prompt

## 4. Runtime Proof

```
Test Suite: 99 tests, 0 failures, 0.007s

Level 1 (Group Mapping):
  B1 Kitchen Log → RIM ✓ (e2e pipeline)
  B2 Kitchen Log → STONE_OAK ✓ (e2e pipeline)
  B3 Kitchen Log → BANDERA ✓ (e2e pipeline)

Level 2 (Header Detection):
  "Bandera Road Food Safety Form" → BANDERA ✓
  "STONE OAK LINE CHECK" → STONE_OAK ✓
  "THE RIM Line Check" → RIM ✓

Level 3 (Template Signature):
  ["RIM-01","RIM-02","RIM-03"] → RIM ✓ (e2e pipeline)
  ["SO-01","SO-02","SO-03"] → STONE_OAK ✓
  ["BAN-01","BAN-02","BAN-03"] → BANDERA ✓
  ["XX-01","YY-02"] → None ✓

Level 4 (Manual Confirmation):
  Unknown group + unknown header + unknown field IDs
  → Reply: "Need store confirmation: 1=B1/The Rim 2=B2/Stone Oak 3=B3/Bandera"
  → Submission NOT discarded ✓
  → Trace ID included ✓
```

## 5. Store Resolution Proof (per required fields)

For each of the 3 production stores:

| Store | Resolution Source | Resolved Store | Selected Column | Field Count | Decision |
|-------|------------------|---------------|----------------|-------------|----------|
| B1 | group_mapping | The Rim | 10AM | 19 | PASS |
| B2 | group_mapping | Stone Oak | 10AM | 19 | PASS |
| B3 | group_mapping | Bandera Road | 10AM | 19 | PASS |

## 6. Compliance

- ✅ Store resolution must never silently fail
- ✅ Must not discard submission on store resolution failure
- ✅ Must not stop pipeline
- ✅ Manual confirmation prompt provided when all levels fail
- ✅ Trace ID always included for audit
- ✅ store_resolution_source field in response

## 7. Deployment

All changes are in the `handwriting-pivot` Python pipeline.
Node.js gateway (`vision_llm_bridge.js`) sends `group_name` to the Python server.
The `store_resolution_source` field is now in the JSON response.

Ready for pilot continuation.
