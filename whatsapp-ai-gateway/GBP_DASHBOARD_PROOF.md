# GBP Dashboard Proof

**Date:** 2026-06-24  
**Dashboard URL:** `http://127.0.0.1:3211/gbp`  
**API Base:** `http://127.0.0.1:3211/api/gbp/*`

---

## Dashboard Components

The GBP dashboard is a single-page application served at `/gbp` that calls all 5 required endpoints and the operational endpoints.

### Sections Rendered

| Section | Source Endpoint | Data Type |
|---------|----------------|-----------|
| Connection Status Badge | `/api/gbp/health` | Live |
| Locations Count Card | `/api/gbp/locations` | Live API |
| Calls (30d) Card | `/api/gbp/calls` | Performance API |
| Directions (30d) Card | `/api/gbp/directions` | Performance API |
| Website Clicks (30d) Card | `/api/gbp/performance` | Performance API |
| Reviews Card | `/api/gbp/reviews` | Live API |
| Locations Table | `/api/gbp/locations` | Live API |
| Performance Metrics Table | `/api/gbp/performance` | Performance API |
| Calls Table | `/api/gbp/calls` | Performance API |
| Directions Table | `/api/gbp/directions` | Performance API |
| Reviews Table | `/api/gbp/reviews` | Live API |
| Raw API Output (collapsible) | All endpoints | JSON |

### Actions

- **Refresh Data** — re-fetches all endpoints
- **Run Full Sync** — POST `/api/gbp/sync` triggers a full sync to `database/gbp/`
- **Connection Test** — opens `/api/gbp/connection-test` in a new tab

---

## Surface Availability

| Surface | Endpoint | Status |
|---------|----------|--------|
| **Dashboard** | `http://127.0.0.1:3211/gbp` | LIVE |
| **n8n** | `/api/gbp/*` (REST, JSON) | READY — n8n can call any endpoint via HTTP Request node |
| **CEO Control Center** | `/api/gbp/dashboard` (aggregated view) | READY |

### n8n Integration

The GBP API follows REST/JSON conventions compatible with n8n's HTTP Request node:

```javascript
// n8n HTTP Request node config:
{
  "url": "http://127.0.0.1:3211/api/gbp/dashboard",
  "method": "GET",
  "headers": { "Accept": "application/json" }
}
```

Set `GBP_N8N_WEBHOOK_URL` in `.env` to push GBP data to n8n workflows.

### CEO Control Center Integration

The aggregated `/api/gbp/dashboard` endpoint returns all data in one call:

```json
{
  "ok": true,
  "dateRange": { "startDate": "2026-05-25", "endDate": "2026-06-24" },
  "locations": {...},
  "performance": {...},
  "calls": {...},
  "directions": {...},
  "reviews": {...},
  "timestamp": "2026-06-24T20:50:00Z"
}
```

---

## File Location

`whatsapp-ai-gateway/public/gbp-dashboard.html`

Served via Express static middleware at `app.get('/gbp', ...)`.

---

## Required Endpoint Mapping

| Required Endpoint | Implemented | Route File |
|-------------------|-------------|-----------|
| GET /api/gbp/locations | YES | `src/gbp/api.js` line 35 |
| GET /api/gbp/performance | YES | `src/gbp/api.js` line 47 |
| GET /api/gbp/reviews | YES | `src/gbp/api.js` line 60 |
| GET /api/gbp/calls | YES | `src/gbp/api.js` line 70 |
| GET /api/gbp/directions | YES | `src/gbp/api.js` line 81 |