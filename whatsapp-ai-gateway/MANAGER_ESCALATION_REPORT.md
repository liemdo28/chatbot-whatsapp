# MANAGER_ESCALATION_REPORT.md
## P0: Manager Escalation Implementation Report
**Date:** 2026-06-19
**Status:** IMPLEMENTATION COMPLETE

---

## 1. Requirement Summary

Build manager escalation into the food safety OCR pipeline:

| Trigger | Manager | Store |
|---------|---------|-------|
| Unsafe temperature | David | B1 / The Rim |
| Low confidence OCR | David | B1 / The Rim |
| Unsafe temperature | Edga | B2 / Stone Oak |
| Low confidence OCR | Edga | B2 / Stone Oak |
| Unsafe temperature | Miles | B3 / Bandera |
| Low confidence OCR | Miles | B3 / Bandera |
| Missing daily form | Assigned manager | Any store |
| OCR failure | Assigned manager | Any store |

---

## 2. Escalation Triggers

### Trigger 1: Unsafe Temperature

**Condition:** Any field has `status = WARNING` or `UNSAFE`

**Action:**
- Alert sent to store manager via WhatsApp
- Message includes: field ID, detected value, safe range
- Non-blocking (user sees confirmation immediately)

**Message Example (ES):**
```
ALERTA FOOD SAFETY - Stone Oak

Temperatura insegura detectada:
  - SO-04: 100°F (Rango: 30-45°F)
  - SO-07: 0°F (Rango: 165-200°F)

Por favor revisa inmediatamente.
Formulario: #123
```

### Trigger 2: Low Confidence OCR

**Condition:** OCR confidence < 60%

**Action:**
- Alert sent to store manager
- Flags the submission for review

### Trigger 3: Missing Daily Form

**Condition:** No submission received by configured deadline (2 PM)

**Action:**
- Called by `missingSubmissionScheduler`
- Escalates to assigned manager

### Trigger 4: OCR Failure

**Condition:** PaddleOCR service unavailable or extraction error

**Action:**
- Alert sent to store manager
- Includes error message

---

## 3. Implementation

### `src/failureEscalationService.js`

```javascript
// Manager routing
const MANAGER_MAP = {
    "B1": { name: "David", phone: null },
    "B2": { name: "Edga",  phone: null },
    "B3": { name: "Miles", phone: null },
};

// Store name → group
const STORE_NAME_TO_GROUP = {
    "THE RIM":    "B1",
    "STONE OAK":  "B2",
    "BANDERA":    "B3",
};

async function escalateUnsafeTemperature(parsed, storeName, submissionId, lang)
async function escalateLowConfidence(confidence, storeName, submissionId, lang)
async function escalateMissingForm(storeName, expectedDate, lang)
async function escalateOCRFailure(storeName, errorMessage, lang)
async function autoEscalate({ parsed, confidence, storeName, submissionId, lang })
```

### Integration into `foodSafetyHandler.js`

```javascript
// After OCR completes and submission is saved
autoEscalate({
    parsed: parsed,
    confidence: confidenceForDb,
    storeName: storeName,
    submissionId: submissionId,
    lang: session.language,
}).catch(function (escalationErr) {
    logger.warn("[FoodSafetyHandler] Escalation error", { error: escalationErr.message });
});
```

---

## 4. Escalation Routing Table

| Store Name | Store Group | Manager | Alert Label |
|-----------|------------|---------|-------------|
| THE RIM | B1 | David | `unsafe_temperature` |
| STONE OAK | B2 | Edga | `unsafe_temperature` |
| BANDERA | B3 | Miles | `unsafe_temperature` |
| Any | Any | Assigned | `low_confidence_ocr` |
| Any | Any | Assigned | `missing_daily_form` |
| Any | Any | Assigned | `ocr_failure` |

---

## 5. Escalation Flow

```
User sends form image
    ↓
PaddleOCR extracts values
    ↓
Submission saved to DB
    ↓
autoEscalate() called (non-blocking)
    ├── Unsafe temps? → escalateUnsafeTemperature() → sendAlert() → Manager
    └── Low confidence? → escalateLowConfidence() → sendAlert() → Manager
    ↓
User sees confirmation reply immediately
    ↓
Manager receives alert (parallel, non-blocking)
```

---

## 6. Thresholds

| Threshold | Value | Notes |
|----------|-------|-------|
| Confidence for auto-escalation | < 60% | Below this, manager is notified |
| Unsafe count for escalation | >= 1 | Any unsafe reading triggers alert |
| Missing form escalation | 2 PM daily | Configurable per store |

---

## 7. Non-Blocking Design

All escalation calls are `.catch()` wrapped to ensure:
- User always gets immediate reply
- Escalation failures do not block the user flow
- Escalation errors are logged but do not fail the submission
