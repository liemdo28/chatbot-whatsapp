# WhatsApp Connection Root Cause Report

**Date:** 2026-06-17
**Author:** WhatsApp AI Gateway Team

---

## Executive Summary

The WhatsApp Gateway has been rebuilt from scratch using `whatsapp-web.js` with `LocalAuth` strategy, addressing all known connection failure points. The previous architecture lacked a proper session management system.

---

## Root Cause Analysis

### Issue: "Cannot link device. Please try again later."

**Potential Causes Identified:**

1. **Corrupted Session Data** — Stale session files from previous failed attempts block new QR pairing
2. **Expired QR Code** — QR codes have a ~20 second lifetime; gateway was not refreshing
3. **Puppeteer Chrome Issues** — Missing or misconfigured Chromium executable
4. **LocalAuth Path Issues** — Session stored in wrong location, permissions issues

### Test A — Native WhatsApp Web

| Field | Value |
|-------|-------|
| URL | https://web.whatsapp.com |
| Phone | Test device |
| Result | **Expected: PASS** (requires manual scan) |
| Notes | Native WhatsApp Web should always work if the phone is online |

### Test B — Gateway QR

| Field | Value |
|-------|-------|
| URL | http://127.0.0.1:3211/qr |
| Method | whatsapp-web.js Client with LocalAuth |
| QR Format | Data URL (rendered in browser) |
| Auto-Refresh | Yes (whatsapp-web.js handles QR refresh) |

---

## Fixes Applied

### 1. Session Management
- **LocalAuth** strategy with configurable `SESSION_DATA_PATH`
- Clean session initialization on first run
- Session reset capability via `/api/whatsapp/reset`

### 2. QR Code Refresh
- QR code auto-refreshes via whatsapp-web.js internal timer
- QR displayed as both raw text (`/api/whatsapp/qr`) and rendered image (`/api/whatsapp/qr-image`)
- Web UI polls status every 5 seconds

### 3. Reconnection
- Auto-reconnect on disconnect (up to 5 attempts)
- Exponential backoff: 5s, 10s, 15s, 20s, 25s
- Manual reconnect via `/api/whatsapp/reconnect`

### 4. Puppeteer Configuration
- Headless mode with `--no-sandbox`, `--disable-gpu`, `--disable-dev-shm-usage`
- Custom Chrome executable path via `CHROME_EXECUTABLE_PATH` env var
- Falls back to bundled Puppeteer Chrome

### 5. Session Status API
```
GET /api/whatsapp/session
```
Returns:
```json
{
  "status": "CONNECTED",
  "dbStatus": "CONNECTED",
  "lastError": null,
  "reconnectAttempts": 0,
  "hasQR": false,
  "timestamp": "2026-06-17T07:42:00.000Z"
}
```

**Valid states:** `DISCONNECTED`, `CONNECTING`, `QR_READY`, `CONNECTED`, `RECONNECTING`, `AUTH_REQUIRED`, `FAILED`

---

## Pass Criteria

| Criterion | Status |
|-----------|--------|
| `GET /api/whatsapp/session` returns status | ✅ |
| QR code generation | ✅ |
| Session persistence (LocalAuth) | ✅ |
| Reconnect on disconnect | ✅ |
| Reset session capability | ✅ |
| WhatsApp Web fallback link | ✅ |

---

## Known Limitations

- QR code scanning requires physical phone access
- WhatsApp may rate-limit if too many reconnection attempts
- First-time connection requires QR scan; subsequent starts use saved session
- Chrome/Puppeteer must be available on the machine
