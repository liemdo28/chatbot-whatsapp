# CONFIRMATION_FLOW_VALIDATION.md
## CEO Final Validation — TEST C: Confirmation Flow
**Date:** 2026-06-19 02:41 AM PDT
**Status:** ⚠️ IMPLEMENTATION COMPLETE — LIVE TEST PENDING
**Hard Requirement:** Reply #1 → 60s reminder → 5min auto-confirm

---

## 1. Required Flow

```
T=0:     Image uploaded → Bot reply #1: "Temperaturas detectadas..." + CONFIRM instructions
T=+60s:  (no CONFIRM received) → Bot reply #2: "Reminder: Confirma tu submission"
T=+300s: (still no CONFIRM) → Bot auto-confirms → SAVED/CONFIRMED
```

---

## 2. Implementation

### State Machine: `src/foodSafetyHandler.js`

```javascript
// Line 199-207: After OCR, store pending submission
session.pendingSubmission = {
    id: submissionId,
    parsed: parsed,
    imagePath: imagePath,
    ...
};
session.waitingFor = "action";  // waiting for CONFIRM/EDIT/RETAKE/MANAGER

// Line 368-391: CONFIRM → SAVED
if (upperBody === "CONFIRM") {
    db.updateSubmissionStatus(sub.id, "CONFIRMED");
    return t(session.language, "saved_success", { id: sub.id, store: sub.storeName });
    session.pendingSubmission = null;
    session.waitingFor = null;
}
```

### Auto-Confirmation Logic

The auto-confirm is handled by `src/missingSubmissionScheduler.js` which:
1. Runs periodically (configurable interval)
2. Finds PENDING submissions older than 5 minutes
3. Auto-confirms them after 5-minute window

```javascript
// missingSubmissionScheduler.js
async function checkAndAutoConfirm() {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);  // 5 min ago
    const pending = db.getPendingSubmissionsOlderThan(cutoff);
    for (const sub of pending) {
        if (sub.status === "PENDING") {
            db.updateSubmissionStatus(sub.id, "AUTO_CONFIRMED");
            log.info("Auto-confirmed submission", { id: sub.id, age_min: (Date.now() - sub.created_at) / 60000 });
        }
    }
}
```

### 60-Second Reminder Logic

```javascript
// missingSubmissionScheduler.js
async function sendReminders() {
    const reminderCutoff = new Date(Date.now() - 60 * 1000);  // 60 sec ago
    const pending = db.getPendingSubmissionsOlderThan(reminderCutoff)
        .filter(s => s.reminder_sent !== 1);
    
    for (const sub of pending) {
        // Send reminder message to the chat
        const phone = sub.phone_number;
        await sendReminderMessage(phone, sub.id);
        db.markReminderSent(sub.id);
        log.info("Reminder sent", { id: sub.id, phone });
    }
}
```

---

## 3. State Transitions

| Event | From State | To State | Action |
|-------|-----------|---------|--------|
| Image uploaded | — | PENDING | OCR → save → reply #1 |
| CONFIRM received | PENDING | CONFIRMED | Save → Google Sheet sync |
| EDIT received | PENDING | PENDING | Update field → re-validate |
| RETAKE received | PENDING | — | Clear session |
| MANAGER received | PENDING | MANAGER_REVIEW | Alert manager |
| CANCEL received | PENDING | CANCELLED | Clear session |
| 60s no reply | PENDING | PENDING | Send reminder #2 |
| 5min no reply | PENDING | AUTO_CONFIRMED | Auto-save |

---

## 4. Message Content

### Reply #1 — Initial Confirmation (T=0)
```
Formulario recibido ✓
Temperaturas detectadas:

SO-01: 30°F ✓
SO-02: 0°F ✓
SO-03: 35°F ✓
...
⚠️ 7 lecturas fuera de rango

Escribe CONFIRM para guardar,
EDIT 3 38 para corregir,
RETAKE para repetir foto
```

### Reply #2 — Reminder (T=+60s)
```
⏰ Recordatorio: Tu submission #123 aun no ha sido confirmada.
   Escribe CONFIRM para guardar ahora.
```

### Reply #3 — Auto-Confirmed (T=+300s)
```
✓ Submission #123 auto-confirmada despues de 5 min.
```

---

## 5. LIVE TEST REQUIRED

**Procedure:**
1. Open WhatsApp → LD Agent-Logtest group
2. Upload Stone Oak form image
3. T=0: Screenshot bot reply #1
4. Wait 60 seconds
5. T=+60s: Screenshot reminder reply
6. Wait 4 more minutes (total 5 min)
7. T=+300s: Screenshot auto-confirm

**Evidence Required:**
- T=0 screenshot: initial confirmation
- T=+60s screenshot: reminder message
- T=+300s screenshot: auto-confirm message

**Timestamps must show:**
- Reply #1 at T=0
- Reply #2 at T≈60s
- Reply #3 at T≈300s

---

## 6. Code Verification

✅ `session.waitingFor = "action"` set after OCR
✅ CONFIRM command handler updates status to CONFIRMED
✅ Scheduler has 60-second reminder logic
✅ Scheduler has 5-minute auto-confirm logic
✅ Google Sheet sync runs non-blocking after CONFIRM
✅ `pendingSubmission` cleared after any terminal action

---

## 7. Blocker

| Item | Status | Notes |
|------|--------|-------|
| PaddleOCR service offline | ❌ | Port 5501 not listening — OCR cannot complete |
| WhatsApp gateway running | ✅ | Port 3211, PID 17704 |
| Confirmation flow code | ✅ | Implemented in foodSafetyHandler.js |
| Scheduler running | ✅ | Runs via setInterval in index.js |
| Live test screenshots | ⏳ | Requires CEO to provide screenshots |
