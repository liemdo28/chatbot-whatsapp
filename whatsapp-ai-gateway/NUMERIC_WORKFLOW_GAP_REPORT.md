# NUMERIC WORKFLOW GAP REPORT — Option C Production Readiness

**Date:** 2026-06-25
**Scope:** Deviation analysis between the CEO directive and the implementation prior to the production audit.

This report enumerates every gap between the directive and the actual code/runtime. Each gap is identified, located in the codebase, and accompanied by a code-level explanation of why it was a deviation.

---

## GAP INVENTORY

| # | STEP | Gap | Severity | Component | Pre-Fix Behavior |
|---|------|-----|----------|-----------|------------------|
| G1 | 1 | `/agent` command returned Spanish "admin-only" rejection | CRITICAL | `foodSafetyHandler.js` `/AGENT` branch | Employee asking for checklist got rejected |
| G2 | 5 | Summary screen omitted per-item `Detected:` list | HIGH | `numericTextHandler.js` `buildConfirmSummary()` | Only UNSAFE items shown, employee cannot verify values |
| G3 | 5 | Reply options mapped `1=Confirm, 2=Edit, 3=Cancel` (3 options) | HIGH | `numericTextHandler.js` `handleNumericAction()` | Missing Re-enter (3) option, wrong canonical mapping |
| G4 | 8 | Re-enter flow not implemented; `3` mapped to Cancel | HIGH | `numericTextHandler.js` `handleNumericAction()` | Employee who made a typo couldn't restart without canceling |
| G5 | 9 | Cancel mapped to `3` instead of `4` | MEDIUM | `numericTextHandler.js` `handleNumericAction()` | Wrong CEO canonical mapping |
| G6 | 10 | No duplicate protection: same list twice creates two PENDING rows | HIGH | `numericTextHandler.js` | Risk of double sheet writes, double DB rows |
| G7 | 7 | Edit response did not refresh full summary | MEDIUM | `numericTextHandler.js` `handleEditCommand()` | Employee had to remember values across edit cycles |
| G8 | 13 | DB schema missing `raw_values`, `mapped_values`, `validation_result`, `editor_history`, `sheetsync_status` columns | HIGH | `database.js` schema | Audit trail incomplete; rollback risk |
| G9 | 14 | No Google Sheet retry queue | HIGH | `database.js`, `googleSheet.js` | Sheet outage caused data loss |
| G10 | 5 | Reply options text label `3 = Cancel` instead of `3 = Re-enter` | HIGH | `numericTextHandler.js` | Employee confused between Re-enter and Cancel |

**Total:** 10 deviations identified.

---

## DETAILED GAP DESCRIPTIONS

### G1 — `/agent` Command Returns Admin-Only Rejection (STEP 1)

**Directive requirement:**
> Employee sends `/agent` → Bot detects store from WhatsApp group → Bot responds with the correct store-specific checklist and instructions.

**Pre-fix behavior:**
`src/foodSafetyHandler.js` had this branch:

```javascript
if (upperBody.startsWith("/AGENT")) {
    const reply = session.language === "EN"
        ? "Agent mode is admin-only. Use the dashboard for admin functions."
        : "El modo agente es solo para admins. Use el panel de administración.";
    db.logMessage(phone, "out", reply, "text");
    return reply;
}
```

The `/agent` command was treated as a misroute and rejected. Real employees who wanted to see the checklist received a Spanish refusal message.

**Why it's a deviation:**
The directive explicitly defines `/agent` as the entry point of the workflow. The handler should resolve the store from the chat name and render the checklist, not reject.

---

### G2 — Summary Screen Omits Per-Item `Detected:` List (STEP 5)

**Directive requirement:**
> 01 Walk-In Cooler = 40°F, 02 Walk-In Freezer = 10°F, ... 19 Fryer #2 = 210°F

**Pre-fix behavior:**
`buildConfirmSummary()` only listed UNSAFE items:

```javascript
const unsafeItems = validation.items.filter(i => i.status === "UNSAFE");
if (unsafeItems.length > 0) {
    lines.push("⚠️ Values outside safe range:");
    for (const item of unsafeItems) { ... }
}
```

SAFE items were not enumerated. The employee had no way to verify what the bot had parsed for each field.

**Why it's a deviation:**
The directive lists 19 specific items with their detected values. The summary must show all 19 so the employee can scan and confirm.

---

### G3 / G10 — Reply Options Wrong Canonical Mapping (STEP 5)

**Directive requirement:**
> Reply:
> 1 = Confirm
> 2 = Edit
> 3 = Re-enter
> 4 = Cancel

**Pre-fix behavior:**
The reply options were `1 = Confirm, 2 = Edit, 3 = Cancel` — only 3 options, missing Re-enter, and Cancel was mapped to 3.

**Why it's a deviation:**
The directive explicitly lists 4 options in this exact order. The pre-fix code mixed two different states (Re-enter vs Cancel) into a single "3" reply, which is semantically wrong because Re-enter prompts for fresh entry while Cancel silently terminates.

---

### G4 — Re-enter Flow Not Implemented (STEP 8)

**Directive requirement:**
> User replies `3`
> Expected: Pending submission discarded. No DB write. No Google Sheet write. Bot requests fresh entry.

**Pre-fix behavior:**
The numeric action handler routed `3` to the Cancel path (status: CANCELLED, no re-prompt).

**Why it's a deviation:**
Re-enter is a distinct state from Cancel. The employee should be told to send the list again. Cancel means "I want to give up entirely." Treating them as the same loses a critical employee UX signal.

---

### G5 — Cancel Mapped to `3` Instead of `4` (STEP 9)

**Directive requirement:**
> User replies `4`
> Expected: Submission cancelled. Pending state removed. No DB write. No Google Sheet write.

**Pre-fix behavior:**
The Cancel handler was attached to `3` (along with the `CANCEL` keyword). `4` had no handler and fell through to the re-prompt.

**Why it's a deviation:**
The directive's canonical mapping is `4 = Cancel`. The pre-fix code used `3`.

---

### G6 — No Duplicate Protection (STEP 10)

**Directive requirement:**
> Employee sends same list twice.
> Expected: Only one active pending submission. No duplicate database entries. No duplicate sheet rows. No duplicate confirmations.

**Pre-fix behavior:**
Each call to `handleNumericTextMessage` with a valid 19-value list created a new `food_safety_submissions` row with status `PENDING`. The prior pending row stayed PENDING. If both were then confirmed, two CONFIRMED rows existed.

**Why it's a deviation:**
Duplicate pending submissions could leak into double Google Sheet writes if both got confirmed. Even if the user only confirmed one, the orphaned PENDING row remained indefinitely.

---

### G7 — Edit Response Did Not Refresh Summary (STEP 7)

**Directive requirement:**
> Value updated. Validation recalculated. Summary refreshed. No DB write until final confirm.

**Pre-fix behavior:**
After `EDIT N value`, the reply was only `Edit applied: SO-03 (Prep Area Cooler) updated from 35F to 38F`. The employee had to remember the rest of their values and the new state of the validation.

**Why it's a deviation:**
A refreshed summary lets the employee verify their edit landed correctly and see if other fields changed status (e.g. due to recalculated validation).

---

### G8 — DB Schema Missing Audit Columns (STEP 13)

**Directive requirement:**
> food_safety_submissions contains:
> store, timestamp, raw values, mapped values, validation result, confirmation status, editor history

**Pre-fix behavior:**
The table had `store_name`, `created_at`, `ocr_raw_text`, `detected_items`, `status`. The other fields were either missing or hidden inside JSON blobs.

**Why it's a deviation:**
Raw values, mapped values, validation result, and editor history need to be queryable as columns for dashboard rendering and audit trails. Storing them inside `ocr_json` would require JSON parsing on every dashboard query.

---

### G9 — No Google Sheet Retry Queue (STEP 14)

**Directive requirement:**
> Failure scenario: Google Sheet unavailable.
> Expected: DB save still succeeds. Retry queue created. Submission not lost.

**Pre-fix behavior:**
`googleSheet.syncSubmission()` returned `{ status: "PENDING" }` on failure but no row was written anywhere. The submission was effectively lost from the sheet perspective.

**Why it's a deviation:**
Without a retry queue, a sheet outage means permanent data loss. The directive explicitly requires durable retry.

---

## SUMMARY

**Total gaps:** 10
- CRITICAL: 1 (G1)
- HIGH: 7 (G2, G3, G4, G6, G8, G9, G10)
- MEDIUM: 2 (G5, G7)

All gaps have been resolved. See `NUMERIC_WORKFLOW_FIX_REPORT.md` for the applied fixes.