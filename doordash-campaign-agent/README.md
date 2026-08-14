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
npm install --legacy-peer-deps --ignore-scripts
npm rebuild better-sqlite3 --legacy-peer-deps
```

Run build and verification:

```bash
npm run build
npm run test:weekly-window
npm run test:production-storage
npm run test:production-openai
npm run test:production-ingestion
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

## Required production secrets

GitHub Actions workflow `doordash-weekly-production` expects:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `DOORDASH_PRODUCTION_DATABASE_URL`
- `DD_REPORT_ALLOWED_SENDERS`
- `IMAP_HOST`
- `IMAP_PORT`
- `IMAP_SECURE`
- `IMAP_USER`
- `IMAP_PASS`
- `DD_REPORT_INBOX_LABEL` (optional but recommended)

## What is still intentionally excluded

- ChatGPT web browser automation is not on the production path.
- Persistent browser profiles are not on the production path.
- DoorDash portal scraping is not on the production path.
- Self-hosted laptop runners are not on the production path.
