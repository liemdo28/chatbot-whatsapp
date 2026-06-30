# QuickBooks SDK / QBXML Integration Plan

## Current Status (Phase 1)

The agent currently uses **registry + tasklist** only:
- `reg query HKLM\SOFTWARE\Intuit\QuickBooks` — detects installed version
- `tasklist /FI "IMAGENAME eq QBW32.EXE"` — detects running process
- No SDK, no QBXML, no data access

## Phase 2: Read-Only SDK Integration

### Options

| Approach | Pros | Cons |
|---|---|---|
| **QB Web Connector** | SOAP, supports scheduled queries | Deprecated for new apps, complex setup |
| **QBFC (C++ COM)** | Official, full feature set | Windows-only COM, complex packaging |
| **QBSDK** | Official, powerful | Requires QB open, COM overhead |
| **QODBC** | SQL-like, many integrations | Third-party, license cost |

### Recommended for Phase 2

**QB Web Connector + QBXML** with these read-only requests:

```
CompanyQueryRq        → verify file open, company name
AccountQueryRq        → chart of accounts check
VendorQueryRq         → vendor list
InvoiceQueryRq        → recent invoices (last 30 days)
SalesReceiptQueryRq    → sales receipts check
PaymentQueryRq         → payments received
BillQueryRq           → bills outstanding
TxnDataExtDefQueryRq  → custom fields (if used)
```

### Phase 2 Workflow Integration

Each workflow in `src/workflows/` will call `sendQbXmlRequest()` with the appropriate QBXML request. The response is parsed and:
- `success` → workflow status = `done`
- `empty/count=0` → workflow status = `missing`
- `error` → workflow status = `failed`
- `needs_confirmation` → workflow status = `needs_user`

### Phase 3: Controlled Write

Write operations (PostInvoice, PostPayment, etc.) are **blocked** until:
1. `ENABLE_QB_WRITE_ACTIONS=true` in `.env`
2. Per-action explicit approval flag
3. QA sign-off in `reports/QA_APPROVAL.md`

## QBXML Request Format

```xml
<?xml version="1.0" encoding="utf-8"?>
<?qbxml version="13.0"?>
<QBXML>
  <QBXMLMsgsRq onError="continueOnError">
    <CompanyQueryRq />
  </QBXMLMsgsRq>
</QBXML>
```

## Testing

- Use a test company file (never production)
- QB must be running and company file open for SDK access
- Log all QBXML requests/responses (without sensitive data)
