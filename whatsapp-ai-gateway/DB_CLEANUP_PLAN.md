# DATABASE CLEANUP PLAN

**Date:** 2026-06-20
**Purpose:** Normalize database tables, map old tables into core tables, archive unused tables.

---

## Core Tables (KEEP)

These are the canonical tables for the hybrid vision architecture:

| Table | Purpose | Module |
|-------|---------|--------|
| `food_safety_submissions` | One row per form submission | database.js |
| `food_safety_edits` | Audit trail for edits (CONFIRM/EDIT/MANUAL) | database.js |
| `message_log` | Inbound/outbound message log | database.js |
| `handwriting_cell_dataset` | Cell-level handwriting dataset | handwriting/dbSchema.js |
| `handwriting_writer_profiles` | Writer-specific profiles | handwriting/dbSchema.js |
| `food_safety_decision_audit` | Per-field decision audit trail | database.js |
| `food_safety_processing_lock` | One-image dedup lock | database.js |
| `capture_rate_log` | Capture rate KPI per submission | captureRateDashboard.js |
| `capture_rate_daily` | Daily aggregated capture rate | captureRateDashboard.js |
| `ceo_handwriting_ground_truth` | CEO-confirmed ground truth | database.js |
| `ceo_runtime_prediction_audit` | Prediction audit per field | database.js |
| `missing_submission_alerts` | Alert audit log | alertAuditLog.js |
| `whatsapp_sessions` | WhatsApp session status | database.js |

## Pilot Tables (KEEP — Simplified)

| Table | Purpose | Action |
|-------|---------|--------|
| `pilot_submissions` | Pilot submission telemetry | KEEP — already has all KPIs |
| `pilot_writer_memory_proof` | Per-field OCR vs memory vs final | KEEP — essential for accuracy tracking |
| `pilot_field_accuracy` | Ground truth comparison | KEEP — required for field accuracy KPI |
| `pilot_alert_log` | Alert quality tracking | KEEP — required for false alert KPI |
| `pilot_manager_routing` | Manager routing validation | KEEP — required for routing KPI |
| `pilot_summary` | Daily aggregated summary | KEEP — dashboard rollup |

## Tables to Archive (Not Destroy)

These tables exist but are no longer actively written to by the main pipeline:

| Table | Status | Action |
|-------|--------|--------|
| `whatsapp_sessions` | Active (status tracking) | KEEP |
| `handwriting_forms` | Active (form-level handwriting metadata) | KEEP |
| `ceo_handwriting_batches` | Active (batch import metadata) | KEEP |
| `ceo_handwriting_cell_crops` | Active (CEO crop storage) | KEEP |

## No Data Destruction

- **Rule:** No table will be DROPped during this refactor.
- Old tables that are no longer written to will be left in place.
- All historical data is preserved for audit and backfill purposes.
- If a table is truly unused (0 rows, no code references), it can be archived in a future cleanup — NOT during this refactor.

## New Tables Needed

| Table | Purpose | Module |
|-------|---------|--------|
| `vision_review_log` | Vision AI review decisions per field | visionAiReviewer.js |
| `store_knowledge_config` | Store-specific field rules (optional, could be code-only) | storeKnowledge.js |

## Migration Steps

1. ✅ Audit complete — all tables documented above.
2. ✅ No new fragmented tables created — all new data goes into existing or clearly-named new tables.
3. Vision review logs will use `vision_review_log` table (created by visionAiReviewer.js init).
4. Store knowledge config will be code-based (JSON in storeKnowledge.js), not a separate table.

## Summary

- **KEEP all existing tables** — nothing to archive or destroy.
- **CREATE 1 new table:** `vision_review_log` (for vision AI reviewer audit trail).
- **Store knowledge is code-based** — no DB table needed.
- **Zero data loss risk.**
