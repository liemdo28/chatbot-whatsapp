# FOOD SAFETY GROUP BEHAVIOR V2

## Status: DESIGN COMPLETE — RUNTIME PROOF PENDING

Author: DEV1
Date: 2026-06-18
Runtime: Laptop1 (PID 20976)
Scope: WhatsApp Food Safety chatbot in `C:\Users\hoang\Downloads\source\setup-all\whatsapp-ai-gateway`

This document is the design contract for the v2 behavior. The current runtime already implements most of the safety / OCR / confidence gate logic, but several v2 rules (single message, 60s reminder, 5-minute auto-confirm, manager alert routing, group reminder, official-form allowlist) still need code changes. **No changes will be merged until runtime proof is collected from the live WhatsApp group.**

---

## 1. State Machine

Each chat group has one active session. Sessions move through these states:

```
                     image received
                          │
                          ▼
                  ┌────────────────┐
                  │  DOWNLOADING    │
                  └───────┬────────┘
                          │ media ready
                          ▼
                  ┌────────────────┐
                  │  DETECTING      │  (form-id text + visual signature)
                  └───────┬────────┘
              not official │
                  form      │
                          ▼
                  ┌────────────────┐    optional save
                  │  IGNORED        │ ──── to evidence_photos (no reply)
                  │  (silent)       │
                  └────────────────┘
                          │
                  official form (v3)
                          ▼
                  ┌────────────────┐
                  │  OCR_RUNNING    │  (silent — no chat reply yet)
                  └───────┬────────┘
                          │ OCR result + IM-* items
                          ▼
                  ┌────────────────┐
                  │ WAITING_CONFIRM │  (60s reminder, then 5min auto)
                  └───────┬────────┘
            ┌─────────┬────┼────┬─────────────┐
            │         │    │    │             │
   CONFIRM  │   EDIT │  RETAKE   MANAGER    CANCEL
            │         │    │    │             │
            ▼         ▼    ▼    ▼             ▼
        SUBMITTED  EDITED RE-OCR  ESCALATED  CANCELLED
            │
            ▼
       SAVED+SHEET
```

States:

- `DOWNLOADING` — media being fetched from WhatsApp
- `DETECTING` — running template detection (text + visual)
- `IGNORED` — non-official form, no submission, optionally saved as evidence
- `OCR_RUNNING` — running template OCR (silent, no chat reply)
- `WAITING_CONFIRM` — single message sent with OCR result + 60s reminder + 5min auto-confirm
- `SUBMITTED` — user replied CONFIRM, saved to DB + sheet queued
- `EDITED` — user replied EDIT, re-runs validation
- `RETAKE` — user replied RETAKE, session cleared
- `ESCALATED` — user replied MANAGER, alert sent to manager group with @mention
- `CANCELLED` — user replied CANCEL, session cleared
- `AUTO_CONFIRMED` — 5 min elapsed, confidence ≥ 90%, no unsafe, no missing → auto-saved

---

## 2. Rules (Mapped to CEO Directive)

### RULE 1 — One OCR Message Only

- Process silently during `DOWNLOADING`, `DETECTING`, `OCR_RUNNING`
- Send **one** message when entering `WAITING_CONFIRM`
- That single message contains:
  - Header: `Food Safety Form Detected`
  - Store, date
  - `IM-01` through `IM-19` (or as many items as the form has)
  - Reply prompt: `CONFIRM`, `EDIT IM-XX <value>`, `RETAKE`, `MANAGER`, `CANCEL`
- No `Analizando imagen...`, no `Recibí el formulario...`, no intermediate status messages

**Code location to modify:** `src/food-safety/food-safety-pipeline.js` (or wherever the analysis messages are emitted). The current pipeline calls `warningGenerator` and may emit multiple warnings. We must collapse all per-item warnings into the single final WAITING_CONFIRM block.

### RULE 2 — 60s Reminder Window

- After entering `WAITING_CONFIRM`, set a 60s timer
- If the employee has not replied, send **one** reminder:
  ```
  Please review your Food Safety submission.

  Reply:
  CONFIRM
  EDIT
  RETAKE
  MANAGER
  ```
- After the reminder, do not send any further nudges — fall through to RULE 3

**Code location to modify:** `src/sessions/session-timeout-service.js`. Currently the timeout service has multiple farewell events; we must collapse to a single reminder at 60s.

### RULE 3 — Auto-Confirm at 5 Minutes

- After entering `WAITING_CONFIRM`, set a 5-minute (300s) auto-confirm timer
- When the timer fires:
  - **If** `confidence >= 90%` AND no unsafe warning AND no missing fields → transition to `AUTO_CONFIRMED`, save to DB, queue sheet write, send one message: `Saved automatically (5 min, confidence ≥ 90%)`
  - **Else** → transition to `MANAGER_REVIEW`, send alert to manager group with `@ManagerName`, do NOT auto-save

**Code location to modify:** `src/sessions/session-timeout-service.js` and a new `src/food-safety/auto-confirm.js`.

### RULE 4 — Only Official Forms

Recognize only:

- `FoodSafety-StoneOak-v3`
- `FoodSafety-Rim-v3`
- `FoodSafety-Bandera-v3`

Detection logic uses:
1. Form ID text in the image header (highest weight)
2. Visual template signature match (alignment + crop consistency)
3. Sender + group context (known store group)

Everything else:
- **Ignored** state
- Optionally save as evidence (no reply, no OCR, no submission)

**Code location to modify:** `src/food-safety/image-analyzer.js` + `src/template-ocr/template-cache.js` (the existing template cache already has `daily-entry-v1`; we need to add the three v3 templates).

### RULE 5 — Group Reminder (Cross-Store)

- When the first valid form arrives at any of the 3 stores, mark that store as submitted at that timestamp
- Start a 30-minute rolling window per shift window
- For each of the other stores that has NOT submitted within the window, send **one** reminder to its store group:

  ```
  Food Safety submission missing.

  Store:
  Stone Oak

  Please upload today's form.
  ```

- After one reminder per store per window, suppress further reminders until the next shift window

**Code location to modify:** `src/workflows/missing-submission-reminder.js` (existing module, needs adjustment to be store-window-based and one-shot per cycle).

### RULE 6 — Log Groups Only

- The Food Safety bot processes images **only** in the configured allowlist groups
- The allowlist is `FOOD_SAFETY_ENABLED_GROUPS` (already set to 3 real production groups in `.env`)
- All other groups → silent, no OCR, no replies, no commands, no reminders
- Personal (non-group) chats → only processed if explicitly `FOOD_SAFETY_ENABLED=true` and message contains image (currently the gate is `if (!isGroup && process.env.FOOD_SAFETY_ENABLED !== 'true') return;`)

**Code location to modify:** `src/whatsapp/message-listener.js` — already gates on `FOOD_SAFETY_ENABLED_GROUPS` and `isGroup`, but we need to verify the allowlist check is strict (currently it's an env-var list, we need to also cross-check `group_workflow_config` to ensure active=1).

### RULE 7 — Manager Alert Group

- A single manager group receives all alerts
- Message format:

  ```
  ⚠️ Food Safety Alert

  Store: Rim
  Employee: Maria
  Issue: Unsafe Temperature

  Item:
  IM-01 Walk-In Cooler

  Expected:
  ≤ 45°F

  Captured:
  58°F

  Dashboard: <submission link>
  ```

- Triggered by: unsafe temperature, missing submission, low confidence OCR, duplicate form, repeated failures, manager review requested, EDIT errors
- Group ID stored in `MANAGER_ALERT_GROUP_CHAT_ID` env var (currently NOT SET — needs to be added)

**Code location to modify:** `src/alerts/manager-alert-service.js` (existing) and add the manager alert group routing.

### RULE 8 — Manager Mention

- Store → manager mapping (lives in DB or env):

  ```
  Rim       → David
  Stone Oak → Manager A
  Bandera   → Manager B
  ```

- Each manager alert starts with `@<ManagerName>` and the rest of the alert body
- Mapping stored in new table `manager_mapping(store_id, manager_name, manager_phone)`

**Code location to modify:** add `src/alerts/manager-mapping.js` + a new SQLite table.

### RULE 9 — No Group Noise (Successful Submission)

- One upload that succeeds must produce **at most 2 messages**:
  1. The OCR result (single message, per RULE 1)
  2. A brief confirmation after CONFIRM (or auto-confirm): `Saved. Thank you.`
- No `processing...`, no `analyzing...`, no `ocr...`, no `loading...`
- No repeated notifications

**Code location to modify:** `src/food-safety/food-safety-pipeline.js` (suppress progress messages) and `src/whatsapp/reply-service.js` (single-shot confirmation).

---

## 3. Timers

| Timer | Trigger | Action | Repeat? |
| --- | --- | --- | --- |
| 60s reminder | Enter `WAITING_CONFIRM` | Send one nudge | No |
| 5 min auto-confirm | Enter `WAITING_CONFIRM` | Auto-save if eligible | No |
| 30 min cross-store | First valid form in window | Remind the other 2 stores once | No |

---

## 4. Allowed Groups (Production Allowlist)

Configured in `.env` (`FOOD_SAFETY_ENABLED_GROUPS`) and `group_workflow_config`:

| Store | Chat ID | Status |
| --- | --- | --- |
| Rim | `120363365547218966@g.us` | Active, food_safety_capture |
| Stone Oak | `120363349425133238@g.us` | Active, food_safety_capture |
| Bandera | `120363409731424335@g.us` | Active, food_safety_capture |

All other groups: silent.

---

## 5. Manager Alert Routing

- Manager group ID: needs to be set in `MANAGER_ALERT_GROUP_CHAT_ID` (not yet set)
- Each store has a `manager_mapping` row
- Alert format: `@<ManagerName>` + the alert body

---

## 6. Code Changes Required (Pre-Deploy Checklist)

- [ ] Add `MANAGER_ALERT_GROUP_CHAT_ID` to `.env`
- [ ] Add `manager_mapping` SQLite table (store_id, manager_name, manager_phone)
- [ ] Insert manager mapping rows (Rim → David, Stone Oak → Manager A, Bandera → Manager B)
- [ ] Modify `src/food-safety/food-safety-pipeline.js` to emit **one** consolidated message at the end of OCR
- [ ] Modify `src/sessions/session-timeout-service.js` to send one reminder at 60s (no repeating)
- [ ] Add `src/food-safety/auto-confirm.js` for the 5-minute auto-save with eligibility check
- [ ] Modify `src/template-ocr/template-cache.js` to add `FoodSafety-StoneOak-v3`, `FoodSafety-Rim-v3`, `FoodSafety-Bandera-v3` (or keep `daily-entry-v1` and add v3 alias)
- [ ] Modify `src/food-safety/image-analyzer.js` to do strict form-id detection (text + visual)
- [ ] Modify `src/workflows/missing-submission-reminder.js` for cross-store one-shot reminder
- [ ] Modify `src/whatsapp/message-listener.js` to cross-check `group_workflow_config.active=1`
- [ ] Modify `src/alerts/manager-alert-service.js` to send to manager group with `@Mention` prefix
- [ ] Add `manager_mapping` SQLite migration

---

## 7. Runtime Validation Plan

After all code changes are merged, run the live tests again:

1. **Single message proof** — Upload form, count bot replies in 5 seconds. Expect exactly 1.
2. **60s reminder proof** — Wait 60s after form OCR, expect 1 reminder. Wait 5 min, expect auto-save if eligible.
3. **Auto-confirm proof** — Upload clean form (≥90% confidence), wait 5 min, expect auto-save message.
4. **Non-form proof** — Upload food photo, expect zero reply. Check `evidence_photos` for the saved entry.
5. **Official-form-only proof** — Upload handwritten form, expect zero reply.
6. **Cross-store reminder proof** — Upload from Rim, wait 30 min, expect Stone Oak and Bandera groups each get 1 reminder.
7. **Manager alert proof** — Upload with unsafe temperature, expect @David in manager group.
8. **Manager mention proof** — Verify the `@ManagerName` is in the alert body.

---

## 8. Current Status (Do Not Deploy)

The current runtime PID 20976 is running the **v1 behavior** (multiple messages, no 60s reminder, no auto-confirm, no manager group routing, no strict form allowlist). It correctly:

- Detects images in the 3 configured groups
- Runs OCR / template matching
- Saves to `template_ocr_runs` table
- Saves non-form images to `evidence_photos` (currently empty)

But it does **NOT** implement:

- Single consolidated message (RULE 1)
- 60s reminder (RULE 2)
- 5 min auto-confirm (RULE 3)
- Official-form-only allowlist (RULE 4)
- Cross-store reminder (RULE 5)
- Manager alert group (RULE 7)
- Manager mention (RULE 8)

---

## 9. Decision

**Per the CEO directive ("Do not deploy until runtime proof exists"), the v2 behavior will NOT be deployed until:**

1. All code changes above are implemented
2. Unit tests pass for each rule
3. Live WhatsApp tests pass (8 scenarios above)
4. This report is updated to PASS with screenshot evidence
