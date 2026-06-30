# Security Policy — qb-ops-agent

## Core Rules

1. **Never store QuickBooks passwords in plain text**
2. **Never log sensitive financial data** (amounts, account numbers, transaction IDs)
3. **Machine token file** (`.machine_token`) must have filesystem permissions 0600
4. **Phase 1 = read-only**: no QB data is read or written
5. **CEO/Admin only** can view sensitive accounting status on dashboard

## Sensitive Data (Log Sanitizer)

The following field names are automatically redacted in all Winston logs:

```
password, passwd, token, secret, credential,
ssn, account_number, card_number, cvv,
routing_number, amount, balance, transaction_id
```

## Credential Storage (Future Phases)

When Phase 2+ requires QB credentials:
- Use Windows Credential Manager (`cmdkey`) or DPAPI
- Never write to `.env`, `company-files.json`, or SQLite
- Encrypt at rest with AES-256-GCM using a per-machine key derived from the machine token
- Document credential retrieval in `SECURITY.md` update

## Network Security

- All outbound HTTP uses HTTPS for production endpoints (`dashboard.bakudanramen.com`)
- Agent OS endpoint (`AGENT_OS_API_URL`) should be HTTPS in production
- Machine token passed as `Authorization: Bearer <token>` header
- Token never appears in logs (sanitized)

## Windows Service Account

- Run the Windows service as a standard user (not SYSTEM if possible)
- Grant minimal filesystem permissions: read-only on QB company files
- No network share access unless required

## Audit Trail

All significant events are logged:
- Agent startup/shutdown
- Heartbeat sent/failed/queued
- Workflow run started/completed
- Queue flush events
- Machine registration

Log files rotated at 10 MB, max 5 files (tailed).

## Screen Automation Safety

`ENABLE_SCREEN_AUTOMATION=false` enforced at all times in Phase 1.
If Phase 2 enables screen automation:
1. Must be explicitly enabled per-machine in `.env`
2. All automated actions logged with screenshots (optional)
3. User confirmation required before any write action
