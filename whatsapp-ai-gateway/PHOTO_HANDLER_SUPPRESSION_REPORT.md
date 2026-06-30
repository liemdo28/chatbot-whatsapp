# PHOTO HANDLER SUPPRESSION REPORT
## CEO Directive — P0 Photo Reply Spam Elimination
### Date: 2026-06-28

---

## Problem

When an employee sent a photo in a Food Safety group (B1/B2/B3 Kitchen Log, LD Agent-Logtest), the bot replied with the full `PHOTO_WORKFLOW_RETIRED_REPLY` text **every single time**:

```
Food Safety photo processing is no longer used for this pilot.
Please use the new workflow:
1. Type /agent
2. Enter the temperature readings as numbers
...
```

This caused reply spam — employees sending multiple photos got multiple replies.

---

## Root Cause

`foodSafetyHandler.handleImageMessage()` had a hard-coded return of `PHOTO_WORKFLOW_RETIRED_REPLY` for every photo in pilot groups. No throttle, no dedup, no per-user tracking.

---

## Fix Applied

### 1. Per-User-Per-Shift Throttle (`foodSafetyPilotGuard.js`)

Added `getPhotoInstruction(phone)` which:
- Computes current shift from `America/Chicago` time
- Creates dedup key: `{phone}|{business_date}|{shift}`
- Returns `SHORT_PHOTO_INSTRUCTION` only on first photo per user per shift
- Returns `null` (silent) for all subsequent photos

```javascript
const SHORT_PHOTO_INSTRUCTION = "Photos are not used for this pilot. Please type /agent and enter the numbers.";
```

### 2. Silent Ignore as Default (`foodSafetyHandler.js`)

`handleImageMessage()` now:
1. Detects pilot group
2. Calls `getPhotoInstruction(phone)`
3. If instruction returned → reply once
4. If null → return null (silent ignore)
5. Never enters Vision/OCR pipeline

### 3. Unified Handler Suppression (`clientManager.js`)

The `sendWhatsAppReply()` function already checks `if (!reply) return;`, so returning `null` from `handleImageMessage` means zero WhatsApp message sent.

---

## Behavior Matrix

| Photo # | User | Shift | Behavior |
|---------|------|-------|----------|
| 1st | User A | 10AM | Short instruction (once) |
| 2nd | User A | 10AM | Silent (null) |
| 3rd | User A | 10AM | Silent (null) |
| 1st | User A | 4PM | Short instruction (new shift) |
| 1st | User B | 10AM | Short instruction (different user) |

---

## What NEVER Happens

- ❌ Photo saved as submission
- ❌ `processSubmissionBatch` called
- ❌ `python_vision_llm_pipeline` invoked
- ❌ `openaiVision` called
- ❌ `Gemini` called
- ❌ `Tesseract` called
- ❌ `PaddleOCR` called
- ❌ Runtime proof block in reply
- ❌ Repeated reply spam
- ❌ Legacy missing-form workflow triggered
- ❌ Reminder logic triggered

---

## Test Coverage

| Test | Description | Status |
|------|-------------|--------|
| PHOTO-1 | Photo before /agent does not create submission | PASS |
| PHOTO-2 | Photo before /agent does not call Vision/OCR | PASS |
| PHOTO-3 | Photo before /agent sends at most one short instruction | PASS |
| PHOTO-4 | Multiple photos do not spam replies | PASS |
| PHOTO-12 to 15 | Photo in each pilot group is suppressed | PASS |
| PHOTO-16 | Photo does not call Vision/OCR | PASS |
| PHOTO-17 | Photo does not include runtime proof | PASS |

---

## Status

```
PHOTO HANDLER SUPPRESSED
REPLY SPAM ELIMINATED
```
