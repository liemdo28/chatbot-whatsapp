# DoorDash Weekly Production Workflow

This branch moves the weekly production path away from browser automation.

## Production architecture

- Weekly ingestion uses IMAP email/export delivery, not DoorDash portal scraping.
- Campaign analysis uses the official OpenAI API, reading only `OPENAI_API_KEY` and `OPENAI_MODEL`.
- Production rejects the browser provider through `DD_ANALYSIS_PROVIDER=openai`.
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
npm run test:weekly-window
npm run test:production-storage
npm run test:production-openai
npm run test:production-ingestion
npm run test:production-runner
npm run test:workflow-validation
```

Run the weekly production workflow locally against fixture reports:

```bash
DD_EXECUTION_ENV=test \
DD_REPORT_SOURCE=fixture \
DD_ANALYSIS_PROVIDER=openai \
DD_STORAGE_BACKEND=sqlite \
OPENAI_API_KEY=your_key \
OPENAI_MODEL=your_model \
npm run automation:weekly:production -- --trigger manual --stores raw-sushi-bar --week-start 2026-07-13 --week-end-exclusive 2026-07-20
```

The production workflow runs every Sunday at `18:05 UTC`. If the report email has not arrived yet, the workflow retries within the run and treats the failure as pending external data until `DD_REPORT_DELIVERY_GRACE_HOURS` has elapsed after the scheduled run time.

## Required repository variables

GitHub Actions workflow `doordash-weekly-production` expects these repository variables:

- `OPENAI_MODEL`
- `DD_REPORT_ALLOWED_SENDERS`
- `IMAP_HOST`
- `IMAP_PORT`
- `IMAP_SECURE`
- `DD_REPORT_INBOX_LABEL` (optional)

## Required repository secrets

GitHub Actions workflow `doordash-weekly-production` expects these repository secrets:

- `OPENAI_API_KEY`
- `DOORDASH_PRODUCTION_DATABASE_URL`
- `IMAP_USER`
- `IMAP_PASS`

## Gmail / IMAP operating requirements

- Use a dedicated reporting mailbox, not a personal inbox, so allowed-sender filtering stays tight and audit scope stays narrow.
- `IMAP_PASS` should be a Gmail App Password for the mailbox account. A normal Gmail password is not the recommended production setup.
- Enable IMAP for that mailbox and keep `IMAP_HOST=imap.gmail.com`, `IMAP_PORT=993`, `IMAP_SECURE=true` unless your provider explicitly documents another TLS-safe combination.
- `DD_REPORT_ALLOWED_SENDERS` is mandatory. Only exact allowed senders are considered valid report sources.
- Supported report artifacts are limited to `.zip`, `.csv`, `.xlsx`, and `.xls`, with a 15 MB attachment/download cap.
- ZIP reports are parsed in memory only, reject unsafe paths such as `../...`, and cap total file count and uncompressed size before parsing.
- Workflow diagnostics store run summaries and file basenames only; mailbox bodies, attachment bytes, and credentials are not written to diagnostic artifacts.
- IMAP access uses explicit connection, greeting, and socket timeouts, and authentication failures are surfaced separately from "report not arrived yet".

## What is still intentionally excluded

- ChatGPT web browser automation is not on the production path.
- Persistent browser profiles are not on the production path.
- DoorDash portal scraping is not on the production path.
- Self-hosted laptop runners are not on the production path.
