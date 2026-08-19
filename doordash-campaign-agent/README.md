# DoorDash Weekly Production Workflow

This branch moves the weekly production path away from browser automation.

## Production architecture

- Weekly ingestion uses IMAP email/export delivery, not DoorDash portal scraping.
- Campaign analysis supports `ANALYSIS_PROVIDER=rules`, `ANALYSIS_PROVIDER=openai`, and `ANALYSIS_PROVIDER=hybrid`.
- Production defaults to `ANALYSIS_PROVIDER=rules` when no provider is configured.
- `rules` is fully deterministic and does not require `OPENAI_API_KEY`.
- `openai` requires `OPENAI_API_KEY` and `OPENAI_MODEL`.
- `hybrid` always generates rule-based recommendations first, then adds optional OpenAI enrichment when a key is configured.
- GitHub-hosted execution uses `ubuntu-latest` with root workflows under `.github/workflows/`.
- Persistent production state is abstracted behind a storage adapter:
  - `sqlite` for local development
  - `postgres` for GitHub-hosted production

## Local verification

Install dependencies:

```bash
npm ci
```

Run build and verification:

```bash
npm run build
npm run preflight:production -- --trigger local-preflight --stores raw-sushi-bar --week-start 2026-07-13 --week-end-exclusive 2026-07-20
npm run validate:production-store-config
npm run test:weekly-window
npm run test:production-sanitization
npm run test:production-rules
npm run test:production-hybrid
npm run test:production-preflight-rules
npm run test:production-postgres-tls
npm run test:production-storage
npm run test:production-openai
npm run test:production-ingestion
npm run test:production-postgres
npm run test:production-runner
npm run test:workflow-validation
```

First-time Postgres setup is automatic. Point `DATABASE_URL` at the target database, keep `DD_STORAGE_BACKEND=postgres`, then run:

```bash
npm run validate:production-store-config
```

That command runs migrations, bootstraps the configured stores with non-destructive upserts, and verifies that `raw-sushi-bar` is mapped to DoorDash Store ID `892006` before a production run.

For Supabase-hosted production Postgres, keep TLS enabled and provide the trusted root CA through `DOORDASH_PRODUCTION_DATABASE_CA_CERT`. Local development may instead set `DOORDASH_PRODUCTION_DATABASE_CA_CERT_PATH` to an external PEM file path. The CA must contain a PEM `BEGIN CERTIFICATE` / `END CERTIFICATE` block. Certificate verification is not disabled in any supported environment.

Run the weekly production workflow locally against fixture reports:

```bash
DD_EXECUTION_ENV=test \
DD_REPORT_SOURCE=fixture \
ANALYSIS_PROVIDER=rules \
DD_STORAGE_BACKEND=sqlite \
npm run automation:weekly:production -- --trigger manual --stores raw-sushi-bar --week-start 2026-07-13 --week-end-exclusive 2026-07-20
```

The production workflow runs every Sunday at `18:05 UTC`. If the report email has not arrived yet, the workflow retries within the run and treats the failure as pending external data until `DD_REPORT_DELIVERY_GRACE_HOURS` has elapsed after the scheduled run time.

Manual `workflow_dispatch` now defaults to `run_mode=preflight`. Preflight validates isolated config presence, IMAP authentication, report discovery/parsing, Postgres migrations, the `raw-sushi-bar -> 892006` mapping, and provider-specific readiness without persisting production snapshots or recommendations.

- `rules` preflight validates deterministic rules configuration and does not require `OPENAI_API_KEY`.
- `openai` preflight preserves the existing OpenAI connectivity check.
- `hybrid` preflight validates rules mode first and treats OpenAI enrichment as optional until a key is configured.

## Rules-mode defaults

These defaults are intentionally conservative and should be tuned to the business:

- `DD_RULE_MIN_ROAS=3`
- `DD_RULE_MAX_CPA=25`
- `DD_RULE_MIN_SPEND=25`
- `DD_RULE_MIN_IMPRESSIONS=1000`
- `DD_RULE_MIN_CLICKS=25`
- `DD_RULE_DETERIORATION_PCT=0.2`
- `DD_RULE_BUDGET_INCREASE_CEILING_PCT=0.2`
- `DD_RULE_VERSION=rules-v1`
- `DD_STORE_CURRENCY=USD`
- `DD_STORE_TIMEZONE=America/Los_Angeles`

For the current production branch, `DD_STORE_TIMEZONE=America/Los_Angeles` and `DD_STORE_CURRENCY=USD` are configurable assumptions for `raw-sushi-bar`, not verified store metadata from DoorDash. They must be set explicitly in repository variables and confirmed by the user before live production sign-off. The weekly scheduler timezone is separate and should remain `Asia/Ho_Chi_Minh`.

The deterministic rules engine calculates spend, attributed sales, orders, ROAS, optional impressions/clicks-derived metrics when the export provides them, week-over-week changes, and store share metrics. Unavailable metrics remain unavailable rather than being coerced to zero.

Each persisted recommendation stores:

- `rule_id`
- `rule_version`
- severity
- detected condition
- supporting metrics
- expected benefit
- confidence
- whether human approval is required
- enrichment status

Each store/week also persists a sanitized review package in Postgres with:

- executive summary
- campaign metrics table
- anomalies
- rule-based recommendations
- follow-up questions
- a ready-to-copy ChatGPT prompt

In production, that review package is persisted only in Postgres. It is not written to public GitHub artifacts.

## Required repository variables

GitHub Actions workflow `doordash-weekly-production` expects these repository variables:

- `ANALYSIS_PROVIDER` with recommended value `rules`
- `DD_REPORT_ALLOWED_SENDERS`
- `IMAP_HOST`
- `IMAP_PORT`
- `IMAP_SECURE`
- `DD_STORE_TIMEZONE` for the current store reporting timezone assumption
- `DD_STORE_CURRENCY` for the current store currency assumption
- `DD_REPORT_INBOX_LABEL` (optional)
- `OPENAI_MODEL` (required only for `ANALYSIS_PROVIDER=openai`; optional otherwise)

## Required repository secrets

GitHub Actions workflow `doordash-weekly-production` expects these repository secrets:

- `DOORDASH_PRODUCTION_DATABASE_URL`
- `DOORDASH_PRODUCTION_DATABASE_CA_CERT`
- `IMAP_USER`
- `IMAP_PASS`

`OPENAI_API_KEY` is required only when `ANALYSIS_PROVIDER=openai`. It is optional in `rules` mode and optional for enrichment in `hybrid` mode.

No legacy DoorDash browser credentials, MI Core credentials, QB/QBWC credentials, browser cookies, or browser session profiles are used on the production path.

## Gmail / IMAP operating requirements

- Use a dedicated reporting mailbox, not a personal inbox, so allowed-sender filtering stays tight and audit scope stays narrow.
- `IMAP_PASS` should be a Gmail App Password for the mailbox account. A normal Gmail password is not the recommended production setup.
- Enable IMAP for that mailbox and keep `IMAP_HOST=imap.gmail.com`, `IMAP_PORT=993`, `IMAP_SECURE=true` unless your provider explicitly documents another TLS-safe combination.
- `DD_REPORT_ALLOWED_SENDERS` is mandatory. Only exact allowed senders are considered valid report sources.
- Supported report artifacts are limited to `.zip`, `.csv`, `.xlsx`, and `.xls`, with a 15 MB attachment/download cap.
- ZIP reports are parsed in memory only, reject unsafe paths such as `../...`, and cap total file count and uncompressed size before parsing.
- No automatic budget or setting change is executed from these recommendations. Human approval remains required before any campaign change.
- Public GitHub diagnostics are metadata only: workflow/run ID, store slug, completed-week range, provider, rule version, status, sanitized counts, and sanitized failure category.
- Campaign metrics, spend, sales, orders, recommendation text, prompts, mailbox bodies, attachment bytes, and credentials are not written to public GitHub artifacts, issues, or logs.
- IMAP access uses explicit connection, greeting, and socket timeouts, and authentication failures are surfaced separately from "report not arrived yet".

## What is still intentionally excluded

- ChatGPT web browser automation is not on the production path.
- Persistent browser profiles are not on the production path.
- DoorDash portal scraping is not on the production path.
- Self-hosted laptop runners are not on the production path.
