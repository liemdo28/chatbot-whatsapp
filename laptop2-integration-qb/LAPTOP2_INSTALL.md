# LAPTOP2 - Integration-QB Install Guide

This package is a laptop2 deployment bundle for:

- `qb-ops-agent`
- `mi-node-agent`
- `whatsapp-ai-gateway`
- `doordash-agent`

Tracked files now contain placeholders only. Runtime secrets must be supplied locally on the target machine.

## 1. Machine-specific files

The installer seeds these local files if they do not already exist:

- `qb-ops-agent\.env` from `qb-ops-agent\env-laptop2.example.txt`
- `mi-node-agent\.env` from `mi-node-agent\env-laptop2.example.txt`
- `whatsapp-ai-gateway\.env` from `whatsapp-ai-gateway\env-laptop2.example.txt`
- `doordash-agent\.env` from `doordash-agent\env-laptop2.example.txt`

These generated `.env` files are ignored by Git.

## 2. Required values before install can continue

### `qb-ops-agent\.env`

- `MI_CORE_URL`
- `MI_CORE_API_KEY`
- `MACHINE_ID`
- `QBWC_PASSWORD`

### `mi-node-agent\.env`

- `NODE_ID`
- `NODE_SECRET`
- `MI_CORE_URL`

### `doordash-agent\.env`

- `DD_B1_EMAIL`
- `DD_B1_PASS`
- `DD_B2_EMAIL`
- `DD_B2_PASS`
- `DD_B3_EMAIL`
- `DD_B3_PASS`
- `DD_RAW_EMAIL`
- `DD_RAW_PASS`

### `whatsapp-ai-gateway\.env`

No tracked browser profile is provided. Provision runtime WhatsApp auth/session state outside Git before production use.

## 3. Install flow

1. Run `INSTALL-ONE-CLICK.bat`.
2. If `.env` files are missing, the installer creates them from placeholder-only examples.
3. The installer validates required settings and exits non-zero if production configuration is missing.
4. After updating the `.env` files locally, run `INSTALL-ONE-CLICK.bat` again.
5. Start services with `START-ALL.bat`.
6. Run `VERIFY-INSTALL.bat`.

## 4. QuickBooks Web Connector

Use the local values from `qb-ops-agent\.env`:

- App URL: `http://localhost:3457/qbwc`
- Username: `mi-qb-agent`
- Password source: `QBWC_PASSWORD`

Do not copy credentials from Git-tracked documentation.

## 5. Security notes

- Never add real secrets to `env-laptop2.example.txt`.
- Never store browser cookies, Chromium profiles, or session backups in Git.
- If a required credential changes, update only the local ignored `.env` file on the target machine.
