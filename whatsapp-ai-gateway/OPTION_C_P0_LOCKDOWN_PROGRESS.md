# OPTION C P0 LOCKDOWN — IN PROGRESS

## P0 Failures Identified

### P0 Failure 1 — Confirm State Broken
**Location:** `src/foodSafetyHandler.js` lines 1059-1072 + `src/numericTextHandler.js` lines 210-339

**Root Cause Analysis:**
- `handleTextMessage` first checks `upperBody === "/AGENT"` (line 1047)
- Then checks `session.waitingFor === "numeric_action" && session.pendingSubmission` (line 1060)
- Routes to `numericTextHandler.handleNumericTextMessage`
- BUT `numericTextHandler.handleNumericTextMessage` line 219 checks `session.waitingFor === "numeric_action"` and routes to `handleNumericAction`
- This LOOKS correct... but the bug is elsewhere: when session has NO pending and user types `1`, `numericTextHandler.handleNumericTextMessage` is called only if `isNumericList("1")` returns true. Let me check that path...

Actually `isNumericList("1")` would return TRUE since `1` is a single number. This is the bug — when there's no pending submission, a bare `1` gets parsed as a 1-value numeric list, triggering "Received 1/19 values" instead of returning a helpful message.

**Fix Plan:**
1. In `numericTextHandler.handleNumericTextMessage`: BEFORE calling isNumericList, check if body is a bare `1`, `2`, `3`, `4` (or other action keywords) with NO pending submission → return helpful re-prompt
2. Ensure single-value message "1" without pending doesn't create partial submission flow

### P0 Failure 2 — Reminder Uses Old Photo Workflow
**Location:** `src/missingSubmissionDetector.js` lines 25-48

**Current:** Mentions "Food Safety form is missing", "No readable form received", "upload a clear photo"

**Fix:** Replace with numeric submission wording

### P0 Failure 3 — Old Vision Pipeline Appears
**Location:** `src/foodSafetyHandler.js` `processSubmissionBatch`, `clientManager.js` lines 148-153

**Current:** `handleImageMessage` already checks pilot guard and returns PHOTO_WORKFLOW_RETIRED_REPLY for food safety groups. But the underlying `processSubmissionBatch` still has vision/OCR code paths. Need to ensure no fallback in case guard fails.

**Fix:** Make `handleImageMessage` ONLY return retired-photo reply for pilot groups — remove the fallback to processSubmissionBatch.

### P1 Failure 4 — UX Too Long
**Location:** `src/numericTextHandler.js` `buildChecklist` (lines 59-83)

**Fix:** Simplify to the requested format

## Implementation Plan

1. Fix `numericTextHandler.handleNumericTextMessage` — block `1`/`2`/`3`/`4` as temperature values when no pending
2. Simplify `buildChecklist` for `/agent` response  
3. Migrate `missingSubmissionDetector.buildAlertMessage` to numeric wording
4. Harden `handleImageMessage` — never call vision pipeline for pilot groups
5. Add comprehensive tests
6. Create reports

## Status: IN PROGRESS
