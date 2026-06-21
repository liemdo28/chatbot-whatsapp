# Phase 8 — Real QuickBooks Company File Validation

**Date:** 2026-06-03  
**CEO Directive Phase:** 8 of CEO FINAL GATE  
**Status:** ⬜ PENDING — Requires operator with real QuickBooks Desktop

---

## Purpose

Phase 8 validates that the QB Activity Log and QB Activity Timeline systems work correctly against real QuickBooks company data. This cannot be automated — it requires a Windows machine with QuickBooks Desktop and the actual Bakudan company file installed.

---

## Prerequisites

Operator must have:
- Windows 10/11 machine
- QuickBooks Desktop installed (Enterprise Solutions recommended)
- Bakudan company file (.qbw) installed and accessible
- `integration-system` source pulled to local machine
- Python 3.12+ with dependencies installed: `pip install -r desktop-app/requirements.txt`
- Optional: EXE built via `cd desktop-app && .\build_release.ps1`

---

## Validation Checklist

### Step 1 — Pull Latest Source

```powershell
cd e:\Project\Master\Bakudan\integration-system
git pull
```

### Step 2 — Run Full Test Suite

```powershell
python -m pytest tests -q
```

**Expected:** `300 passed, X warnings`

### Step 3 — Build EXE (optional, for built app testing)

```powershell
cd desktop-app
.\build_release.ps1
```

### Step 4 — Start App

**Option A — Run from source:**
```powershell
cd desktop-app
python app.py
```

**Option B — Run built EXE:**
```powershell
.\desktop-app\dist\ToastPOSManager.exe
```

### Step 5 — Confirm App Opens

- App window appears
- Home Dashboard loads
- No crash or error popups

### Step 6 — Confirm QB Auto-Open

- QuickBooks Desktop launches automatically
- Correct company file is opened (check QB title bar)

### Step 7 — Verify Home Dashboard Panels

Screenshot the Home Dashboard showing:
- QB Status panel (should show "QB READY" or equivalent)
- QB Activity Log panel
- **NEW:** QB Activity Timeline panel

### Step 8 — Click "Generate Log Now"

Navigate to: Home Dashboard → QB Activity Log panel → "Generate Log Now"

### Step 9 — Click "Generate Timeline Now"

Navigate to: Home Dashboard → QB Activity Timeline panel → "Generate Timeline Now"

### Step 10 — Verify Generated Files

```powershell
dir logs\qb-activity
```

Expected structure:
```
logs\qb-activity\
  <store-code>\
    <YYYY-MM-DD>.json          ← Activity Log (latest-only)
    <YYYY-MM-DD>.md            ← Activity Log Markdown
    <YYYY-MM-DD>-timeline.json ← Full event timeline
    <YYYY-MM-DD>-timeline.md   ← Timeline Markdown
```

### Step 11 — Validate Activity Log JSON Content

Open `logs\qb-activity\<store-code>\<YYYY-MM-DD>.json`

Verify all required fields:

| Field | Required | Expected |
|-------|----------|----------|
| `store` | ✅ | e.g., "bandera" |
| `store_name` | ✅ | e.g., "Bakudan Bandera" |
| `date` | ✅ | YYYY-MM-DD format |
| `quickbooks_company_file` | ✅ | .qbw filename |
| `quickbooks_company_path` | ✅ | Full path |
| `generated_at` | ✅ | ISO timestamp |
| `status` | ✅ | PASS / WARNING / ERROR |
| `latest_activity` | ✅ | Dict of transaction results |
| `latest_activity.sales_receipt` | ✅ | last_txn_date, ref_number |
| `latest_activity.invoice` | ✅ | If invoices exist |
| `latest_activity.payment` | ✅ | If payments exist |
| `latest_activity.deposit` | ✅ | If deposits exist |
| `latest_activity.journal_entry` | ✅ | If JEs exist |
| `latest_activity.bill` | ✅ | If bills exist |
| `warnings` | ✅ | List (may be empty) |
| `errors` | ✅ | List (must be empty for PASS) |

### Step 12 — Compare JSON vs QuickBooks UI

For each store, manually verify in QuickBooks:

| Transaction Type | JSON field | QB Location | Match? |
|-----------------|------------|-------------|--------|
| Last Sales Receipt date | `latest_activity.sales_receipt.last_txn_date` | Customers → Sales Receipts | ⬜ |
| Last Sales Receipt RefNumber | `latest_activity.sales_receipt.ref_number` | Same | ⬜ |
| Last Sales Receipt amount | `latest_activity.sales_receipt.amount` | Same | ⬜ |
| Last Invoice date | `latest_activity.invoice.last_txn_date` | Customers → Invoices | ⬜ |
| Last Payment date | `latest_activity.payment.last_txn_date` | Customers → Receive Payments | ⬜ |
| Last Deposit date | `latest_activity.deposit.last_txn_date` | Banking → Deposits | ⬜ |
| Last JE date | `latest_activity.journal_entry.last_txn_date` | Company → Journal Entries | ⬜ |
| Last Bill date | `latest_activity.bill.last_txn_date` | Vendors → Bills | ⬜ |
| Last Bank Transaction | `latest_activity.bank_transactions[].last_txn_date` | Banking → Register | ⬜ |
| Last Reconcile date | `latest_activity.reconcile[].last_txn_date` | Banking → Reconcile | ⬜ |

### Step 13 — Validate Timeline JSON

Open `logs\qb-activity\<store-code>\<YYYY-MM-DD>-timeline.json`

| Field | Required | Expected |
|-------|----------|----------|
| `store` | ✅ | Store code |
| `date` | ✅ | Target date |
| `event_count` | ✅ | Number of events |
| `events[].time` | ✅ | HH:MM from TimeModified/TimeCreated |
| `events[].type` | ✅ | sales_receipt, invoice, etc. |
| `events[].ref_number` | ✅ | Transaction reference |
| `events[].txn_date` | ✅ | YYYY-MM-DD |
| `events[].amount` | ✅ | Dollar amount |
| `events[].customer` | ✅ | Customer/vendor name |
| `status` | ✅ | PASS/WARNING/ERROR |
| `warnings` | ✅ | May include timestamp warnings |
| `errors` | ✅ | Must be empty for PASS |

### Step 14 — Compare Timeline vs QuickBooks UI

| Check | QB Location | Match? |
|-------|-------------|--------|
| Event count matches transactions on date | Transactions → Transaction List | ⬜ |
| Events sorted chronologically | — | ⬜ |
| Each event has correct type, ref, date, amount | Transaction details | ⬜ |
| No duplicate txn_ids | — | ⬜ |
| Real timestamps (HH:MM) shown where available | Transaction window | ⬜ |

### Step 15 — Test Error Cases

1. **Wrong company file:** Change `qbw_paths` in local-config.json to point to wrong .qbw → Error status expected
2. **QB not running:** Close QB, click "Generate Log Now" → Error status expected, no crash
3. **Missing bank account config:** Remove bank_accounts from store config → Warning expected
4. **Duplicate guard:** Click "Generate Log Now" twice → Second run skipped, existing log returned

### Step 16 — Safety Verification

Open Windows Task Manager during generation:
- Confirm NO unexpected processes launched
- Confirm no file writes outside `logs/qb-activity/`
- Confirm no QB write operations (QB log should show only queries, not adds/mods/dels)

---

## Stores to Validate

| Store | Company File | Required |
|-------|-------------|----------|
| Bandera | `JHT Ventures Inc (Bandera).qbw` | ✅ |
| Stone Oak | `JHT Ventures Inc (Stone Oak).qbw` | ✅ |
| Culebra | `JHT Ventures Inc (Culebra).qbw` | ⬜ If configured |

---

## Screenshot Evidence Required

1. ⬜ Home Dashboard showing all 3 panels (QB Status, Activity Log, Timeline)
2. ⬜ QuickBooks title bar showing correct company file name
3. ⬜ Activity Log JSON file opened in editor
4. ⬜ Activity Log Markdown file opened in editor
5. ⬜ Timeline JSON file opened in editor
6. ⬜ Timeline Markdown file opened in editor
7. ⬜ QuickBooks transaction list matching JSON data
8. ⬜ Test suite output (`300 passed`)

---

## Completion

After completing all steps above, update this report with:
- Actual values from your validation run
- Screenshots attached (or stored in `reports/screenshots/`)
- Any discrepancies found
- Final PASS/FAIL verdict per store

---

## Evidence Package

**Path:** `reports/evidence/qb-activity-log-uat/`

| File | Description |
|------|-------------|
| `01-home-dashboard.png` | App Home Dashboard |
| `02-qb-company-file.png` | QB company file open |
| `03-generate-log-button.png` | Generate Log button |
| `04-activity-log-json.png` | Activity Log JSON |
| `05-activity-log-markdown.png` | Activity Log Markdown |
| `06-timeline-json.png` | Timeline JSON |
| `07-timeline-markdown.png` | Timeline Markdown |
| `08-end-to-end-video.mp4` | Screen recording |
| `09-test-output.txt` | Test suite output |
| `10-build-output.txt` | Build output |

---

## Operator Result

**Operator:** _______________________  
**Date:** _______________________  
**QuickBooks Version:** _______________________  
**Company File:** _______________________  
**Stores Tested:** _______________________  

---

## Result Matrix

| Check | Result | Evidence |
|---|---|---|
| App opens | ⬜ | 01-home-dashboard.png |
| QB auto-opens | ⬜ | 02-qb-company-file.png |
| Correct company file | ⬜ | QB title bar screenshot |
| Log generates | ⬜ | 04-activity-log-json.png |
| Timeline generates | ⬜ | 06-timeline-json.png |
| JSON has all required fields | ⬜ | JSON file review |
| Markdown has all sections | ⬜ | 05-activity-log-markdown.png |
| Timeline events sorted | ⬜ | 07-timeline-markdown.png |
| QB UI matches JSON | ⬜ | Screenshot comparison |
| No duplicate logs | ⬜ | Log folder review |
| No QB write operations | ⬜ | QB audit log |
| 300/300 tests pass | ⬜ | 09-test-output.txt |
| Built EXE runs | ⬜ | 10-build-output.txt |

---

## Final Verdict (to be filled by operator)

```
╔═══════════════════════════════════════════════════════════════╗
║  [  ] FULL PASS    [  ] PASS WITH WARNINGS    [  ] FAIL     ║
║                                                             ║
║  Bandera:           [  ] PASS  [  ] WARN  [  ] FAIL        ║
║  Stone Oak:         [  ] PASS  [  ] WARN  [  ] FAIL        ║
║  Culebra:           [  ] PASS  [  ] WARN  [  ] FAIL        ║
╚═══════════════════════════════════════════════════════════════╝
```

---

*Template created: 2026-06-03*  
*Operator action required to complete real QB validation*
