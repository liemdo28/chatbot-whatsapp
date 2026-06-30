# REVIEW REPLY AGENT — AUDIT PASS-2 REPORT

**Date:** 2026-06-29
**Author:** Dev1 (Laptop1)
**Scope:** Second-pass audit — edge cases, audit drift, directive compliance, code-vs-report verification

---

## Summary

| Category | Status |
|---|---|
| Unit tests (6/6) | ✅ PASS |
| Persistence (audit log, approvals, drafts) | ✅ All 3 stores verified |
| Approval↔Audit drift | ⚠️ Found (see Finding 2) |
| Aspect detection accuracy | ⚠️ Found (see Finding 1) |
| Directive §10 compliance | ⚠️ Found (see Finding 2) |
| Integration map accuracy | ⚠️ Minor drift (see Finding 3) |
| Health/safety aspect coverage | ⚠️ Gap (see Finding 4) |

---

## Finding 1 — ASPECT DETECTION MISLABELS HEALTH ISSUES

**Severity:** Medium
**File:** `review-agent/aspect.js` lines 79–86
**Status:** ⚠️ BUG — not documented in ERRORS_AND_FIXES.md

### Problem

When no `ASPECT_KEYWORDS` match, `detectAspects()` falls back to a general classifier:

```javascript
if (found.size === 0) {
    const hasPositive = /\b(good|great|amazing|love|loved|nice|delicious|awesome|fantastic)\b/.test(lower);
    const hasNegative = /\b(bad|terrible|horrible|worst|hate|awful|slow|rude|dirty)\b/.test(lower);
    if (hasPositive && !hasNegative) found.add('general_positive');
    else if (hasNegative && !hasPositive) found.add('general_negative');
    else if (hasPositive && hasNegative) { found.add('general_positive'); found.add('general_negative'); }
    else found.add('general_positive'); // ← NEUTRAL/UNKNOWN FALLS HERE
}
```

**"got sick", "allergic reaction", "hospital", "contaminated"** are NOT in the negative-word list and NOT in `ASPECT_KEYWORDS`. Result:

| Review text | Sentiment | Aspects | Problem |
|---|---|---|---|
| "I got sick after eating here." | negative | `general_positive` | ❌ **False label** |
| "You will get sick from here." | negative | `general_positive` | ❌ **False label** |
| "I had an allergic reaction." | negative | `general_positive` | ❌ **False label** |
| "I went to the hospital after eating here." | negative | `general_positive` | ❌ **False label** |

The fallback "general_positive" makes NO SENSE for a review expressing food safety concerns.

### Why it didn't break tests

- `test-cases.js` Case E checks: `auto_reply_allowed`, `risk_level`, `quality_check` — **not `aspects`**
- `risk.js` correctly escalates "got sick" via `ESCALATION_KEYWORDS` (Tier 1b)
- Reply is correct, classification is correct — only the `detected_aspects` field is wrong

### Root Cause

`sentiment.js` correctly detects "sick: -3". But `detectAspects()` does NOT receive the sentiment result — it operates purely on keyword matching. When no keywords match, it falls back to a regex-based general classifier that doesn't know about the sentiment score.

### Fix Recommendation

**Option A (minimal):** Add "sick", "allergic", "hospital", "contaminated" to `ASPECT_KEYWORDS.food_quality` and to the fallback negative-word list.

**Option B (thorough):** Pass `sentiment` into `detectAspects()` and use it in the fallback:
```javascript
if (found.size === 0) {
    if (sentiment?.label === 'negative') found.add('general_negative');
    else if (sentiment?.label === 'positive') found.add('general_positive');
    else found.add('general_positive');
}
```

---

## Finding 2 — MANAGER DECISION DOES NOT UPDATE AUDIT LOG

**Severity:** Medium (directive §10 compliance)
**File:** `review-agent/server.js` line 98–113
**Status:** ⚠️ BUG — not documented

### Problem

The `POST /api/reviews/approvals/:id/decide` endpoint calls `audit.updateApprovalStatus()` which updates only `review_reply_approvals.json`. The audit log (`review_reply_audit_logs.json`) is never touched. This means:

- A manager approves review #1 → `approval.status = "approved"` ✅ in `review_reply_approvals.json`
- But audit log entry still has `approval_status = "pending"` ❌ in `review_reply_audit_logs.json`

### Directive §10 Requirement

> "Every pipeline run must be recorded in a JSON audit log with: review_id, store_id, platform, rating, review_text, detected_sentiment, detected_aspects, risk_level, draft_reply, auto_reply_allowed, **approval_status**, created_at, updated_at, error_message."

The `approval_status` field in the audit log must reflect the final outcome, not just the initial state.

### Evidence

Current probe shows all 9 approval entries have status="pending" in both stores — because no manager decisions have been made yet (no live drift visible until after a decision). However, code inspection confirms:

- `server.js` line 107: `audit.updateApprovalStatus(...)` — only touches `review_reply_approvals.json`
- No call to update `review_reply_audit_logs.json` anywhere in the decision flow

### Fix Recommendation

Add `updateApprovalAuditLog()` in `audit.js` and call it from the `/approvals/:id/decide` endpoint:

```javascript
// In audit.js:
function updateApprovalAuditLog(approvalId, status) {
    const list = _load(AUDIT_PATH);
    const idx = list.findIndex(e => e.approval_id === approvalId);
    if (idx === -1) return null;
    list[idx].approval_status = status;
    list[idx].updated_at = new Date().toISOString();
    _save(AUDIT_PATH, list);
    return list[idx];
}
```

---

## Finding 3 — MINOR REPORT ↔ DISK DRIFT

**Severity:** Low
**File:** `REVIEW_REPLY_AGENT_AUDIT_RUN_REPORT.md`
**Status:** ⚠️ Staleness

### Problem

`REVIEW_REPLY_AGENT_AUDIT_RUN_REPORT.md` reports:

- "9 audit log entries" — but disk now has **15 entries** (multiple audit runs accumulated)
- "4 auto-replied, 1 approval_required, 4 escalation_required" — snapshot at time of run

This is normal for a running system, but the report should note it was a snapshot.

### Recommendation

Add a timestamp noting when the snapshot was taken vs. current disk state.

---

## Finding 4 — MISSING `FOOD_SAFETY` ASPECT TAG

**Severity:** Low
**File:** `review-agent/aspect.js`
**Status:** ⚠️ Gap

### Problem

The `ASPECT_KEYWORDS` object has 11 aspect categories but no `food_safety`. Health-related keywords like "roach", "bug in food", "contaminated" appear in `risk.js ESCALATION_KEYWORDS` but not as aspect tags. This means audit logs and approval messages won't include a `food_safety` tag even when a review mentions a roach in food.

### Recommendation

Add a `food_safety` aspect:
```javascript
food_safety: ['roach', 'rodent', 'rat', 'mouse', 'bug in food', 'mold', 'contaminated', 'allergen', 'allergic reaction'],
```

---

## Verified: What Pass-2 Confirmed as Correct

| Check | Result |
|---|---|
| Audit log has all required fields per directive §10 | ✅ Verified in disk files |
| Drafts persisted correctly | ✅ 15 entries |
| Approvals persisted correctly | ✅ 9 entries |
| 6/6 unit tests pass | ✅ Re-confirmed |
| `classifyRisk()` — 7-tier logic matches directive | ✅ Code matches |
| `sentiment.js` — negative/positive/neutral/mixed labels | ✅ Correct |
| `sentiment.js` — negation handling (`not great`) | ✅ `NOT` negation working |
| `sentiment.js` — but-detection for mixed reviews | ✅ Case C fixed |
| `ROBOTIC_PHRASES` filter active | ✅ 11 phrases blocked |
| Quality check (30–1000 chars) | ✅ All replies pass |
| Reply mentions specific items (Case B) | ✅ "spicy miso ramen" included |
| Escalation reply is brief and human | ✅ Case E, D, F correct |
| Approval message format matches directive §9 | ✅ Format verified |
| `data/store_memory.json` seeded with 4 stores | ✅ 4 stores |
| No external dependencies in agent modules | ✅ All pure Node.js |
| `audit.js` `_load`/`_save` error handling (silent) | ⚠️ Silent — no alerting on write failure |

---

## Files Created This Pass

```
review-auto-bridge/
├── tests/
│   └── audit-pass2-probes.js       (NEW — edge case + drift probes)
└── REVIEW_REPLY_AGENT_AUDIT_PASS2.md  (this file)
```

---

## Recommendations Priority

| Priority | Finding | Action |
|---|---|---|
| P1 | Finding 1 | Fix aspect fallback to not return `general_positive` for negative-sentiment text |
| P1 | Finding 2 | Add `updateApprovalAuditLog()` call on manager decision |
| P2 | Finding 4 | Add `food_safety` aspect to `ASPECT_KEYWORDS` |
| P3 | Finding 3 | Add snapshot timestamp to AUDIT_RUN_REPORT |
| P3 | Silent failures | Add `console.warn` when audit `_save` fails |
