# Operator QB UAT Script
**For:** Non-developer operators  
**Purpose:** Validate QB Activity Log and Timeline systems with real QuickBooks Desktop  
**Time needed:** ~20 minutes  
**Prerequisites:** Windows machine with QuickBooks Desktop installed and Bakudan company files

---

## Before You Start

Make sure you have:
- QuickBooks Desktop open and logged in (or let the app open it)
- The `ToastPOSManager.exe` built or source running
- Your `local-config.json` configured with:
  - `qb_activity_log.stores` — Bandera, Stone Oak (and Culebra if active)
  - `qbw_paths` — paths to your company files

---

## Step-by-Step UAT Validation

### Step 1 — Launch the App

```
Double-click: ToastPOSManager.exe
```

**Expected:** App window opens, Home Dashboard loads.

**Screenshot:** Take a screenshot of the app window.

---

### Step 2 — Confirm QuickBooks Auto-Open

**Expected:** QuickBooks Desktop opens automatically within ~60 seconds of app launch.

**Check:** Look at the QuickBooks window title bar — it should show your company name.

**Screenshot:** Take a screenshot showing both the app window and the QB window.

---

### Step 3 — Find the QB Activity Log Panel

On the Home Dashboard, look for the **QB Activity Log** panel. It should show:
- Status chip (purple)
- "Generate Log Now" button
- "Open Log Folder" button
- Last receipt / Last bank txn / Last reconcile labels

**Screenshot:** Screenshot of the QB Activity Log panel.

---

### Step 4 — Find the QB Activity Timeline Panel

Below the Activity Log panel, look for the **QB Activity Timeline** panel (cyan/teal colored). It should show:
- Status chip
- "Generate Timeline Now" button
- "Open Timeline Folder" button
- Events today / Last type / Last time labels

**Screenshot:** Screenshot of the QB Activity Timeline panel.

---

### Step 5 — Generate QB Activity Log

1. Click **"Generate Log Now"**
2. Wait for the status to change from "Running" → "Done"
3. Look at the detail labels:
   - Last receipt should show a date
   - Last bank txn should show a date
   - Last reconcile should show a date

**Screenshot:** Screenshot after generation completes.

---

### Step 6 — Generate QB Activity Timeline

1. Click **"Generate Timeline Now"**
2. Wait for status to change from "Running" → "Done"
3. Look at the detail labels:
   - Events today should show a count
   - Last type should show a transaction type
   - Last time should show a time

**Screenshot:** Screenshot after generation completes.

---

### Step 7 — Open Log Folder

1. Click **"Open Log Folder"** on the Activity Log panel
2. Windows Explorer should open to `logs\qb-activity\`

**Expected folder structure:**
```
logs\qb-activity\
  <store-code>\
    <YYYY-MM-DD>.json           ← Activity Log
    <YYYY-MM-DD>.md             ← Activity Log Markdown
    <YYYY-MM-DD>-timeline.json   ← Timeline
    <YYYY-MM-DD>-timeline.md    ← Timeline Markdown
```

**Screenshot:** Explorer window showing the folder structure.

---

### Step 8 — Open and Review Activity Log JSON

1. Navigate to `logs\qb-activity\<your-store>\`
2. Open the `.json` file in a text editor (Notepad is fine)
3. Check these fields exist and have values:
   - `store` — your store code
   - `status` — should be "PASS" or "WARNING"
   - `latest_activity` — contains sales_receipt, invoice, payment, etc.
   - `metrics` — contains qb_connect_duration_ms, qb_query_duration_ms, etc.
   - `warnings` — list (may be empty)
   - `errors` — list (must be empty for PASS)

**Screenshot:** JSON file opened in Notepad/editor showing the structure.

---

### Step 9 — Open and Review Activity Log Markdown

1. Open the `.md` file in a browser or text editor
2. Check it shows:
   - Store name and date in the header
   - Latest Sales Receipt section
   - Latest Invoice section
   - Latest Payment section
   - Latest Deposit section
   - Bank Transactions section
   - Reconcile section
   - Performance Metrics table (if available)
   - Warnings section (may say "None")
   - Errors section (should be empty or say "None")

**Screenshot:** Markdown file opened showing all sections.

---

### Step 10 — Open and Review Timeline JSON

1. Open the `-timeline.json` file
2. Check these fields:
   - `event_count` — number of events today
   - `events[].time` — HH:MM times (or "—" if unavailable)
   - `events[].type` — transaction types (sales_receipt, payment, deposit, etc.)
   - `events[].ref_number` — reference numbers
   - `events[].txn_date` — YYYY-MM-DD dates
   - `events[].amount` — dollar amounts
   - `metrics` — timing metrics
   - `warnings` — may include timestamp warnings
   - `errors` — should be empty for PASS

**Screenshot:** Timeline JSON opened in editor.

---

### Step 11 — Open and Review Timeline Markdown

1. Open the `-timeline.md` file
2. Check the Events table shows all transactions in chronological order
3. Check each row has: Time | Type | Ref | Amount | Account/Customer | Status

**Screenshot:** Timeline Markdown opened in browser/editor.

---

### Step 12 — Compare with QuickBooks UI (Manual Verification)

For your store, open QuickBooks and check these match:

| Check | QuickBooks Location | Expected in JSON |
|-------|-------------------|-----------------|
| Last Sales Receipt | Customers → Sales Receipts → most recent | `latest_activity.sales_receipt.last_txn_date` |
| Last Sales Receipt Ref | Same window | `latest_activity.sales_receipt.ref_number` |
| Last Invoice | Customers → Invoices → most recent | `latest_activity.invoice.last_txn_date` |
| Last Payment | Customers → Receive Payments → most recent | `latest_activity.payment.last_txn_date` |
| Last Deposit | Banking → Deposits → most recent | `latest_activity.deposit.last_txn_date` |

**If data matches:** Mark PASS for that check.  
**If data does NOT match:** Mark FAIL and note the discrepancy.

**Screenshot:** QuickBooks window + JSON side by side for comparison.

---

### Step 13 — Test Error Handling

**Test 1: Wrong company file**
1. Temporarily change `qbw_paths` in `local-config.json` to a wrong path
2. Click "Generate Log Now"
3. Expected: Status shows "Failed" with error message
4. Restore the correct path

**Test 2: Duplicate run**
1. Click "Generate Log Now" twice in a row
2. Expected: Second run shows "Log already exists" or skipped — no crash

**Test 3: No bank accounts configured**
1. Remove `bank_accounts` from your store config
2. Click "Generate Log Now"
3. Expected: WARNING status with "No bank accounts configured" message

**Screenshot:** Error states if encountered.

---

### Step 14 — Record Video

Record a short (~2 minute) screen recording:
1. App launching
2. QB auto-connecting
3. Generate Log Now → Done
4. Generate Timeline Now → Done
5. Open log folder → Show files

**Save as:** `09-end-to-end-video.mp4` in the evidence folder.

---

### Step 15 — Run Test Suite

```powershell
cd e:\Project\Master\Bakudan\integration-system
python -m pytest tests -q
```

**Expected:** `300 passed` (warnings are OK).

**Screenshot:** Test output in terminal.

---

## Screenshot Checklist

Save all screenshots to: `reports/evidence/qb-activity-log-uat/`

| File | Screenshot |
|------|-----------|
| `01-home-dashboard.png` | App Home Dashboard with all 3 QB panels |
| `02-qb-company-file.png` | QB window title bar showing company name |
| `03-generate-log-button.png` | "Generate Log Now" button clicked |
| `04-activity-log-json.png` | Activity Log JSON opened in editor |
| `05-activity-log-markdown.png` | Activity Log Markdown opened in browser |
| `06-timeline-json.png` | Timeline JSON opened in editor |
| `07-timeline-markdown.png` | Timeline Markdown opened in browser |
| `08-end-to-end-video.mp4` | Screen recording (2 min) |
| `09-test-output.txt` | Test suite output (copy from terminal) |
| `10-qb-ui-comparison.png` | QB UI + JSON side-by-side |

---

## Final Result Matrix

| Check | Expected | Actual | Result | Notes |
|-------|----------|--------|--------|-------|
| App launches | Window opens | | ⬜ | |
| QB auto-opens | QB launches | | ⬜ | |
| Correct company file | Company name in QB title | | ⬜ | |
| QB Activity Log generates | JSON + MD created | | ⬜ | |
| QB Activity Timeline generates | JSON + MD created | | ⬜ | |
| JSON has all required fields | All fields present | | ⬜ | |
| Markdown has all sections | All sections present | | ⬜ | |
| Timeline events sorted | Chronological | | ⬜ | |
| No QB write operations | Only queries in QB log | | ⬜ | |
| QB UI matches JSON | Dates/refs match | | ⬜ | |
| Duplicate run blocked | Second run skipped | | ⬜ | |
| 300/300 tests pass | Tests pass | | ⬜ | |

---

## Sign-Off

**Operator Name:** _______________________  
**Date:** _______________________  
**QuickBooks Version:** _______________________  
**Company File Used:** _______________________  
**Stores Tested:** _______________________  

**Final Verdict:**

```
[ ] FULL PASS — All checks passed, no issues found
[ ] PASS WITH WARNINGS — All checks passed, minor warnings noted
[ ] FAIL — Critical issue found: _______________________
```

**Comments:**
_______________________________________________
_______________________________________________

---

*Script version: 2026-06-03 | For ToastPOSManager v2.2+*
