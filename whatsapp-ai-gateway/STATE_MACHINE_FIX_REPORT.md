# STATE MACHINE FIX REPORT

**Date:** 2026-06-25  
**P0 Fix:** Confirm State Broken  
**Status:** COMPLETE — 6/6 state machine tests PASS

---

## Problem

Employee sends partial numeric values → bot replies with options (1=Confirm, 2=Edit, 3=Re-enter, 4=Cancel) → employee replies `1` → bot incorrectly treats `1` as a new temperature value and replies "Received 1/19 values. Missing: RIM-02..."

## Root Cause

Two bugs in `src/numericTextHandler.js`:

1. **Bare digit with no pending:** `isNumericList("1")` returns `true` since `1` is a valid number. When no active session existed, the single digit `1` was parsed as a 1-value numeric list.

2. **State machine priority in `handleTextMessage`:** The `/agent` check ran before the numeric action check, and the bare `isNumericList(body)` check ran before verifying the action state was not active.

## Fix Applied

### 1. Added STATE MACHINE PRIORITY 1B guard (`numericTextHandler.js`)

```javascript
// If user types "1", "2", "3", or "4" without an active session,
// treat as a helpful re-prompt — never as a numeric submission.
if (/^[1-4]$/.test(body)) {
    const reply = "No active submission to confirm.\n\nType /agent to start a new Food Safety session, or send 19 temperature readings.";
    db.logMessage(phone, "in", body, "numeric_text");
    db.logMessage(phone, "out", reply, "text");
    return reply;
}
```

### 2. State machine priority order (now enforced)

```
1. If waitingFor === "numeric_action" AND pendingSubmission → handle action (1/2/3/4/EDIT)
2. If bare "1"/"2"/"3"/"4" with NO pending → return helpful message
3. If isNumericList → parse numeric submission
4. Else → return null (not a numeric workflow message)
```

## State Machine Diagram

```
                    ┌──────────────────────┐
                    │   Inbound Message    │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │  waitingFor =        │
                    │  "numeric_action"    │
                    │  AND pending exists? │
                    └──────────┬───────────┘
                         YES/  \NO
                        /      \
            ┌──────────▼┐    ┌──▼──────────────┐
            │  Route to  │    │  Is bare 1-4?   │
            │  action    │    └──────┬──────────┘
            │  handler   │      YES/  \NO
            └────────────┘     /      \
                  │    ┌──────▼┐    ┌──▼────────────┐
                  │    │Helpful│    │ isNumericList? │
                  │    │message│    └──────┬────────┘
                  │    └──────┘      YES/  \NO
                  │               /      \
                  │     ┌────────▼┐    ┌──▼──────┐
                  │     │Parse &  │    │ return  │
                  │     │validate │    │ null    │
                  │     └─────────┘    └─────────┘
```

## Tests

| Test | Description | Result |
|------|-------------|--------|
| SM-1 | Pending submission + reply `1` confirms | PASS |
| SM-2 | Pending submission + reply `2` enters edit | PASS |
| SM-3 | Pending submission + reply `3` re-enters | PASS |
| SM-4 | Pending submission + reply `4` cancels | PASS |
| SM-5 | Pending submission + `1` never parsed as temperature | PASS |
| SM-6 | No pending submission + `1` returns helpful message | PASS |

## Verification Command

```bash
node tests/testOptionCLockdown.js
```
