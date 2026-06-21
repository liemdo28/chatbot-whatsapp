# D2 Sign-Off Audit — Claude Vision Eval

**Date:** 2026-06-21
**Auditor:** Hoang (CEO / D2)
**Eval provider:** Claude Vision (claude-opus-4-7 via opusmax.shop proxy)
**GT file:** `eval/locked_ground_truth.json` (v2, 114 primary cells locked)

---

## Pre-Audit Checklist

Before pasting the output, Dev1 must confirm:

- [ ] Patch `eval_provider_flag.patch` applied cleanly (no merge conflicts)
- [ ] 2 P0 bugs fixed and `tests/test_p0_fixes.py` passes
- [ ] `CLAUDE_API_KEY` env var set (opusmax.shop proxy)
- [ ] Command run: `cd handwriting-pivot && python eval/run_locked_eval.py --provider claude`
- [ ] Output file written: `eval/locked_eval_results_claude.json`

---

## The 6 Output Items Dev1 Must Paste

### Item 1: Overall Accuracy Summary

**What to look for:**
```
Forms tested: 3 (or 4 if legacy included)
Total value cells: 114 (primary) or 132 (all)
Correct: ___
Accuracy: ___%
Accuracy >= 95%: YES ✅ or NO ⛔
```

**Gate:** Accuracy ≥ 95% on 114 primary cells → PASS

---

### Item 2: Per-Form Accuracy

**What to look for:**
```
Bandera Road:     __/__ = __% (___s)
Stone Oak:        __/__ = __% (___s)
The Rim:          __/__ = __% (___s)
```

**Gate:** Each form individually ≥ 90% (no single form catastrophic failure)

---

### Item 3: Sample Match Table (per-cell comparison)

**What to look for:** Each form's cell-by-cell output showing:
- ✅ = model value within ±2°F of GT
- ❌ = mismatch
- ⬜ = null match (both empty)

**Spot-check these high-risk cells:**
| Cell | Store | GT Value | Why risky |
|---|---|---|---|
| BAN-07 | Bandera | 10/12 (Line Freezer) | Broken sensor pattern |
| BAN-16 | Bandera | 351/348 (Fryer Left) | 4PM FAIL, handwriting unclear |
| SO-02 | Stone Oak | 0/10 (Walk-In Freezer) | Previous mismatch at 10 vs 0 |
| SO-11 | Stone Oak | 37/33 (Tapas Top) | CEO noted "ambiguous handwriting" |
| SO-16 | Stone Oak | 350/350 (Fryer Left) | CEO confirmed 350 vs image appearing 360 |
| RIM-07 | Rim | 8/8 (Line Freezer) | Broken sensor pattern |
| RIM-09 | Rim | 140/125 (Sliced Pork Hot) | Above range, unusual value |
| RIM-17 | Rim | 360/340 (Fryer Right) | 4PM FAIL, wide gap |

---

### Item 4: Confidence Calibration

**What to look for:**
```
Cells with confidence < 0.85: ___ cells, error rate: ___%
Cells with confidence >= 0.85: ___ cells, error rate: ___%
```

**Gate:** When model says confidence < 0.85, error rate should be ≥ 70% (meaning low confidence actually correlates with being wrong). If ALL cells are high confidence but errors exist → model is over-confident → CONCERN.

---

### Item 5: Latency

**What to look for:**
```
Latency p95: ___s
Latency p95 <= 8s: YES ✅ or NO ⛔
```

**Gate:** p95 ≤ 8 seconds

**Known issue from D2_ESCALATION.md:** Previous Gemini runs were 15-26s. Claude via proxy may have different latency. If p95 > 8s, document the breakdown (network to proxy, model inference, image compression).

---

### Item 6: Known Disagreements / Ambiguous Cells

**What to look for:** Cells where GT has a note about ambiguity:
- BAN-07: "BROKEN SENSOR — both shifts FAIL by spec" → model should read the actual number (10, 12), not 0
- BAN-12: "4PM FAIL (41>40)" → model should read 41, not round to 40
- BAN-16: "4PM FAIL (348<350)" → model should read 348, not round up to 350
- SO-11: "CEO confirmed; ambiguous handwriting" → model should read 37/33
- SO-16: "CEO confirmed 350 (not 360 as image appears)" → critical: model must match CEO, not apparent visual
- RIM-09: "CEO confirmed; both above range but food-safe" → model should read 140/125
- RIM-17: "4PM FAIL (340<350)" → model should read 340, not round to 350

**Gate:** For cells with GT notes, the model should match the CEO reading (±2°F tolerance applies).

---

## Final Sign-Off Decision Matrix

| Metric | Threshold | Actual | PASS? |
|---|---|---|---|
| Overall accuracy (114 cells) | ≥ 95% | __% | |
| Per-form min accuracy | ≥ 90% each | __% | |
| Confidence calibration | Low-conf error rate ≥ 70% | __% | |
| Latency p95 | ≤ 8s | __s | |
| Known disagreements matched | ≥ 80% of noted cells | __/__ | |
| No data corruption | GT file unchanged | verified | |
| `locked_eval_results_claude.json` exists | file present | | |

### Sign-Off Decision

- [ ] **PASS** → Proceed to pilot decision
- [ ] **CONDITIONAL** → Pass with caveats (document which metrics are marginal)
- [ ] **FAIL** → Do not pilot. Document root cause and next steps.

---

## Notes / Red Flags to Watch

1. **Proxy latency:** opusmax.shop adds a hop. If p95 > 8s, we may need to test direct Anthropic API or a faster provider.
2. **Model over-confidence:** If all cells show >0.85 confidence but some are wrong, the confidence scores are meaningless for triage.
3. **Legacy format (SO-2026-05-27):** The eval script may or may not run this form. If it does, expect different field mapping (row_01 vs SO-01). Treat separately.
4. **Two-shift handling:** Claude provider must correctly parse dual-shift format (v_10am / v_4pm). If it only returns single values, the eval will compare wrong column.
5. **GT file integrity:** After eval, verify `locked_ground_truth.json` has NOT been modified (sha256sum or file timestamp check).
