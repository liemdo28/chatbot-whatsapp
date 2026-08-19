# Laptop2 - Integration-QB Stack

This package must not contain production credentials or browser session state.

## Quick start

1. Copy `laptop2-integration-qb` to the target machine.
2. Run `INSTALL-ONE-CLICK.bat`.
3. The installer creates local `.env` files from placeholder-only `env-laptop2.example.txt` templates.
4. Fill the required values in the generated `.env` files or provide them via machine environment variables.
5. Re-run `INSTALL-ONE-CLICK.bat` after configuration passes validation.
6. Start services with `START-ALL.bat`.
7. Validate connectivity with `VERIFY-INSTALL.bat`.

## Required credential-bearing configuration

- `qb-ops-agent\.env`
  - `MI_CORE_API_KEY`
  - `QBWC_PASSWORD`
- `mi-node-agent\.env`
  - `NODE_SECRET`
- `doordash-agent\.env`
  - `DD_B1_EMAIL`
  - `DD_B1_PASS`
  - `DD_B2_EMAIL`
  - `DD_B2_PASS`
  - `DD_B3_EMAIL`
  - `DD_B3_PASS`
  - `DD_RAW_EMAIL`
  - `DD_RAW_PASS`

## Security rules

- Never commit production tokens, passwords, or session data.
- Keep generated `.env` files local and out of Git.
- Provision WhatsApp browser/session state outside the repository.
- Use placeholders only in tracked docs and templates.

See `LAPTOP2_INSTALL.md` for the full setup flow.
