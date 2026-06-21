# DEPRECATED MODULES

**Date:** 2026-06-20
**Purpose:** Track modules that have been superseded by the hybrid vision architecture.

---

## Deprecated (Superseded by Alert Composer)

| Module | Deprecated By | Reason |
|--------|---------------|--------|
| `failureEscalationService.autoEscalateV2()` | `foodSafetyAlertComposer.sendConsolidatedAlert()` | Alert composer consolidates all alert types into one per submission |
| `failureEscalationService.escalateUnsafeTemperature()` | `foodSafetyAlertComposer` | Now handled by consolidated alert flow |
| `failureEscalationService.escalateLowConfidence()` | `foodSafetyAlertComposer` | Now handled by consolidated alert flow |

**Note:** The `failureEscalationService` module itself is NOT deprecated — its `escalateOCRFailure()` and `getStoreGroup()` utilities are still used by the pipeline. Only the duplicate alert sender functions are superseded by the consolidated Alert Composer.

## Deprecated (Superseded by Vision Reviewer)

| Module | Deprecated By | Reason |
|--------|---------------|--------|
| Direct OCR-based alert firing | `visionAiReviewer + decisionEngine` | Raw OCR can never trigger alerts directly |

## Not Deprecated (Still Active)

| Module | Status | Reason |
|--------|--------|--------|
| `crossFieldIntelligence` | ACTIVE | Cross-field anomaly detection is unique and not replaced |
| `zeroRetakeReplyBuilder` | ACTIVE | Smart reply builder is enhanced, not replaced |
| `captureRateDashboard` | ACTIVE | Capture rate KPIs remain |
| `pilot/livePilotMetrics` | ACTIVE | Pilot telemetry remains (simplified) |
| `acceptanceCriteria` | ACTIVE | System-wide validation remains |

---

## Summary

- **No modules were deleted** — all existing modules remain in the codebase.
- The Alert Composer (`foodSafetyAlertComposer.js`) is the new consolidated path for sending management alerts.
- The Decision Engine (`foodSafetyDecisionEngine.js`) now integrates storeKnowledge and vision fusion.
- Existing modules continue to function — the refactor adds new layers without breaking existing behavior.
