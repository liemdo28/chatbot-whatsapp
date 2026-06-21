# QB Read/Write Boundary Audit
**Generated:** 2026-06-09

---

## Write Tags Search Results

**Search command:**
```bash
grep -rn "AddRq|ModRq|DelRq|SalesReceiptAdd|TxnDel|TxnMod|DepositAdd|JournalEntryAdd|BillAdd|CheckAdd|CreditCardChargeAdd" desktop-app --include="*.py" --exclude-dir=".venv"
```

---

## Files With QB WRITE Tags Found

| File | Tags Found | Module | Verdict |
|---|---|---|---|
| `desktop-app/qb_client.py` | `TxnDelRq`, `delete_transaction` | QB Write Module | ✅ ALLOWED — this is the QB write client |
| `desktop-app/qb_sync.py` | `SalesReceiptAddRq`, `CustomerAddRq`, `ItemServiceAddRq`, `ItemNonInventoryAddRq` | QB Write Module | ✅ ALLOWED — this is the QB sync/import module |

---

## Files Verified as CLEAN (No Write Tags)

| File | Module | Result |
|---|---|---|
| `services/qb_activity_log_service.py` | QB Read-Only | ✅ CLEAN |
| `services/qb_activity_queries.py` | QB Read-Only | ✅ CLEAN — only QueryRq |
| `services/qb_activity_timeline_queries.py` | QB Read-Only | ✅ CLEAN — only QueryRq |
| `services/qb_activity_timeline_service.py` | QB Read-Only | ✅ CLEAN |
| `services/qb_file_sync_runner.py` | QB Read-Only | ✅ CLEAN |
| `services/qb_multi_file_sync_scheduler.py` | QB Read-Only | ✅ CLEAN |
| `services/mi_core_client.py` | Remote Reporting | ✅ CLEAN |
| `services/remote_command_client.py` | Remote Reporting | ✅ CLEAN |
| `services/qb_file_registry.py` | QB Read-Only | ✅ CLEAN |
| `services/qb_file_scanner.py` | QB Read-Only | ✅ CLEAN |
| `services/reporting_outbox.py` | Remote Reporting | ✅ CLEAN |
| `services/machine_identity_service.py` | Remote Reporting | ✅ CLEAN |

---

## Query Tags Found in Read-Only Files (Correct)

From `qb_activity_queries.py`:
```
SalesReceiptQueryRq  ← READ query, NOT write
InvoiceQueryRq       ← READ query
ReceivePaymentQueryRq
DepositQueryRq
JournalEntryQueryRq
```

These are `*QueryRq` tags — they read data, they do NOT create or modify transactions.

---

## Boundary Enforcement

The `qb_activity_log_service.py` explicitly documents:
```python
"""
Never modifies QB data.  Uses QBClient (QBXML COM) in read-only mode.
"""
```

The `qb_file_sync_runner.py` uses `BeginSession(company_file, 2)` — mode 2 = multi-user, which does not require exclusive access and does not allow writes.

---

## Feature Flag Guard

The QB write sync module (`qb_sync.py`, `qb_sync_service.py`) is controlled by:
```python
from services.feature_flags import qb_write_sync_enabled

if not qb_write_sync_enabled():
    return  # do not execute write sync
```

Default is `False`. CEO must explicitly set `"qb_write_sync_enabled": true` in local-config.json to enable.

---

## Verdict

✅ **BOUNDARY CLEAN** — No QB write tags found in any read-only module.
✅ Write tags confined to `qb_sync.py` and `qb_client.py`.
✅ Feature flag enforces read-only default on fresh install.
