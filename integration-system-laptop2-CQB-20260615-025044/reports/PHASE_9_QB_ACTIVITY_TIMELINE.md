# Phase 9 — QB Activity Timeline Report

**Date:** 2026-06-03  
**CEO Directive Phase:** 9 of CEO FINAL GATE  
**Machine:** Windows (dev), Python 3.13.12

---

## Executive Summary

| Area | Result |
|------|--------|
| Full test suite | ✅ **300 PASSED, 0 FAILED** |
| Timeline services created | ✅ 4 new services |
| Timeline tests added | ✅ 47 new tests |
| Home Dashboard panel | ✅ Timeline panel added |
| Read-only safety audit | ✅ ZERO write operations |
| Phase 8 real QB validation | ⬜ PENDING (requires operator with QB Desktop) |

---

## Files Created / Changed

| File | Change |
|------|--------|
| `desktop-app/services/qb_activity_timeline_queries.py` | **NEW** — Read-only QBXML queries returning all transactions |
| `desktop-app/services/qb_activity_timeline_service.py` | **NEW** — Core timeline generation, dedup, sort, JSON+MD output |
| `desktop-app/services/qb_activity_history_store.py` | **NEW** — File-based history retrieval (no QB connection) |
| `desktop-app/services/qb_activity_timeline_scheduler.py` | **NEW** — Daily scheduler for automated timeline generation |
| `desktop-app/ui/home_dashboard.py` | **MODIFIED** — Added timeline panel + `update_timeline_status()` |
| `tests/test_qb_activity_timeline_queries.py` | **NEW** — 11 tests |
| `tests/test_qb_activity_timeline_service.py` | **NEW** — 19 tests |
| `tests/test_qb_activity_timeline_ui_state.py` | **NEW** — 9 tests |
| `tests/test_qb_activity_history_store.py` | **NEW** — 8 tests |

---

## Architecture

```
App.__init__
  └── after(15000ms) → _start_timeline_scheduler()
        └── QBActivityTimelineScheduler.start()  [daemon thread, polls every 60s]
              └── _tick()
                    ├── timeline enabled? → else Off
                    ├── stores configured? → else Off
                    ├── daily_time reached? → else Waiting
                    ├── already triggered today? → Done
                    ├── QB status == QB_READY? → else "QB not ready"
                    └── _run_timelines()
                          └── generate_all_timelines()
                                └── per store: generate_timeline()
                                      ├── duplicate check (file-based)
                                      ├── QBClient.connect(qbw_path) [READ-ONLY]
                                      ├── qb_activity_timeline_queries.* [read-only QBXML]
                                      ├── _dedupe_events() by txn_id
                                      ├── _sort_key() by TimeModified > TimeCreated > TxnDate
                                      ├── write logs/qb-activity/<store>/<date>-timeline.json
                                      └── write logs/qb-activity/<store>/<date>-timeline.md
```

---

## Output Format

### JSON: `logs/qb-activity/<store>/<YYYY-MM-DD>-timeline.json`

```json
{
  "store": "bandera",
  "store_name": "Bakudan Bandera",
  "date": "2026-06-03",
  "quickbooks_company_file": "jht ventures inc (Feb 2025).qbw",
  "quickbooks_company_path": "C:\\QB\\jht ventures inc (Feb 2025).qbw",
  "generated_at": "2026-06-03T09:15:00",
  "generated_at_utc": "2026-06-03T14:15:00Z",
  "status": "PASS",
  "event_count": 3,
  "events": [
    {
      "time": "09:15",
      "type": "sales_receipt",
      "action": "created_or_found",
      "ref_number": "12345",
      "txn_date": "2026-06-03",
      "amount": 120.50,
      "customer": "Toast Sales - Bandera",
      "class": "Bandera",
      "account": "",
      "source": "QuickBooks",
      "txn_id": "TXN-ABC123",
      "time_created": "2026-06-03T09:15:00",
      "time_modified": "2026-06-03T09:16:00"
    },
    {
      "time": "10:01",
      "type": "deposit",
      "action": "created_or_found",
      "ref_number": "DEP-555",
      "txn_date": "2026-06-03",
      "amount": 120.50,
      "customer": "",
      "class": "",
      "account": "Chase Checking - Bandera",
      "source": "QuickBooks",
      "txn_id": "TXN-DEF456",
      "time_created": "2026-06-03T10:01:00",
      "time_modified": null
    }
  ],
  "warnings": [],
  "errors": []
}
```

### Markdown: `logs/qb-activity/<store>/<YYYY-MM-DD>-timeline.md`

```md
# QB Activity Timeline — Bakudan Bandera — 2026-06-03

**Status:** PASS
**Company File:** jht ventures inc (Feb 2025).qbw
**Generated At:** 2026-06-03T09:15:00
**Total Events:** 2

## Events

| Time | Type | Ref | Amount | Account/Customer | Status |
|------|------|-----|-------:|------------------|--------|
| 09:15 | sales_receipt | 12345 | $120.50 | Toast Sales - Bandera | Found |
| 10:01 | deposit | DEP-555 | $120.50 | Chase Checking - Bandera | Found |

## Warnings
None
```

---

## Supported Event Types

| Type | QBXML Query | Notes |
|------|-------------|-------|
| `sales_receipt` | `SalesReceiptQueryRq` | |
| `invoice` | `InvoiceQueryRq` | |
| `payment` | `ReceivePaymentQueryRq` | |
| `deposit` | `DepositQueryRq` | Per-account filter |
| `journal_entry` | `JournalEntryQueryRq` | JE amount = sum of debit lines |
| `bill` | `BillQueryRq` | Vendor in VendorRef |
| `check` | `CheckQueryRq` | Per-account filter |
| `bank_transaction` | Check + Deposit combined | Per account |

---

## Sorting Logic

Events are sorted by the best available timestamp:

1. `TimeModified` — most recent QB action on this transaction (preferred)
2. `TimeCreated` — when the transaction was first created in QB
3. `TxnDate` — date only, no time information (last resort)

If no real timestamps are available, a warning is appended: *"QB did not expose TimeCreated/TimeModified for any transaction."*

---

## Safety Audit

### PowerShell safety scan (QBXML write patterns):

```powershell
Select-String -Path .\desktop-app\services\qb_activity_timeline*.py -Pattern "AddRq|ModRq|DelRq|SalesReceiptAdd|TxnDel|TxnMod|DepositAdd|JournalEntryAdd"
```

**Result:** 0 matches in all timeline service files.

### Python grep confirmation:
```
desktop-app/services/qb_activity_timeline_queries.py  → 0 write operations
desktop-app/services/qb_activity_timeline_service.py → 0 write operations
desktop-app/services/qb_activity_timeline_scheduler.py → 0 write operations
```

### Only query tags used (read-only):
- `SalesReceiptQueryRq` ✅
- `InvoiceQueryRq` ✅
- `ReceivePaymentQueryRq` ✅
- `DepositQueryRq` ✅
- `JournalEntryQueryRq` ✅
- `BillQueryRq` ✅
- `CheckQueryRq` ✅

---

## Test Results

```
300 passed, 116 warnings in 7.94s
  47 new timeline tests (all PASS)
  253 existing tests (all PASS)
```

### Timeline Test Breakdown

| File | Tests | Status |
|------|-------|--------|
| `test_qb_activity_timeline_queries.py` | 11 | ✅ ALL PASS |
| `test_qb_activity_timeline_service.py` | 19 | ✅ ALL PASS |
| `test_qb_activity_timeline_ui_state.py` | 9 | ✅ ALL PASS |
| `test_qb_activity_history_store.py` | 8 | ✅ ALL PASS |

### Key test cases verified:

- ✅ Generates timeline JSON
- ✅ Generates timeline Markdown
- ✅ Sorts events by TimeModified/TimeCreated/TxnDate
- ✅ Groups events by store
- ✅ Missing timestamp becomes warning
- ✅ No QB write operations called
- ✅ Duplicate txn_id deduplication
- ✅ Force regenerate overwrites safely
- ✅ Wrong company file → ERROR
- ✅ No data → WARNING not crash
- ✅ UI summary shows event count + latest event type/time

---

## Home Dashboard — QB Activity Timeline Panel

**Location:** `desktop-app/ui/home_dashboard.py` (timeline section, after Activity Log section)

**Features:**
- Status chip with 6 states: Off, Waiting, QB not ready, Running, Done, Failed
- Color-coded with icon indicators (cyan theme `#0891b2`)
- Detail row: Events today, Last event type, Last event time, Generated timestamp
- Action buttons:
  - **"Generate Timeline Now"** → triggers `_on_generate_timeline()` in daemon thread
  - **"Open Timeline Folder"** → opens Explorer
- Thread-safe UI updates via `update_timeline_status()` → `self.after(0, _update)`
- Summary populated from `qb_activity_history_store.get_summary_for_store()`

---

## Limitations

| Limitation | Severity | Notes |
|------------|----------|-------|
| QB QBXML has no direct "last reconciled date" query | Medium | Approximated via ClearedStatus=Reconciled filter |
| QB QBXML does not expose intraday transaction times for all types | Low | Falls back to TxnDate; warning added |
| Reconcile "ending balance" not available via QBXML | Low | Noted in transaction extra field |
| Live interactive test requires QB Desktop installed | N/A | Operator must complete on QB machine |

---

## Final Verdict

```
╔═══════════════════════════════════════════════════════════════╗
║  PASS                                                       ║
║                                                             ║
║  300/300 tests pass                                        ║
║  47 new timeline tests pass                                 ║
║  ZERO write operations in timeline code path                ║
║  Timeline JSON + Markdown format verified                    ║
║  Home Dashboard timeline panel implemented                   ║
║  Sort by TimeModified/TimeCreated/TxnDate verified         ║
║  Dedup by txn_id verified                                  ║
║  Missing data → WARNING, not crash, verified                ║
║  Wrong company → ERROR, verified                            ║
║  Duplicate guard + force flag verified                      ║
╚═══════════════════════════════════════════════════════════════╝
```

---

*Report generated: 2026-06-03T12:20:00+07:00*  
*Validator: Automated source analysis + pytest execution*
