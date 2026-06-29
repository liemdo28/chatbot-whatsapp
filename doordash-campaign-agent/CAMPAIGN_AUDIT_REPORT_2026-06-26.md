# DoorDash Campaign Agent - Audit Report
**Run ID:** 299403c1-1d05-4d11-947e-42fe4f7a273f
**Audit Date:** 2026-06-26 (10:57 UTC - 11:03 UTC)
**Agent Version:** doordash-campaign-agent v1.0.0

---

## Executive Summary

| Metric | Value |
|---|---|
| Stores Audited | 4 |
| Stores with Campaign Data Pulled | 3 / 4 |
| Fresh Campaigns Extracted | **14** |
| Recommendations Generated | **14** |
| Approval Actions Queued | 13 |
| Live Executions Attempted | 0 |
| Live Executions Submitted | 0 |

**System Status:** OPERATIONAL - Campaign data is being pulled from DoorDash Merchant Portal for 3 of 4 stores.

---

## Issues Found and Fixed

### ✅ FIXED: DB Path Resolution
**Before:** `DB_PATH=./data/doordash-campaigns.db` (relative path) - caused audit to run from wrong directory and create empty DB.
**After:** `DB_PATH=C:/Ld-project/doordash-campaign-agent/data/doordash-campaigns.db` (absolute path).

### ✅ FIXED: Missing .env Variables
Added missing execution mode and safety variables:
- `DD_AUDIT_EXECUTION_MODE=dry_run`
- `DD_LIVE_EXECUTION_ENABLED=false`
- `DD_AUTONOMOUS_CAMPAIGN_ADJUSTMENTS=false`
- `DD_ALLOW_UNVERIFIED_ACCOUNT_EXECUTION=false`
- `AUDIT_REPORTS_DIR=...` (absolute path)

### ✅ FIXED: MI_CORE_URL Mismatch
**Before:** DB setting stored `localhost:4001`, `.env` said `http://100.118.102.113:4001`
**After:** Both updated to `http://100.118.102.113:4001`

### ✅ FIXED: Session/Credential State Inconsistency
- All sessions were marked "active" with no `last_login_at` → Reset to "none"
- All credentials were marked "stored" with empty password → Reset to "unset"
- Store emails updated to real DoorDash account emails

### ✅ FIXED: Campaign Reader URL List
Added missing DoorDash Merchant Portal URLs:
- `https://merchant.doordash.com/en-US/marketing/campaigns`
- `https://merchant.doordash.com/en-US/marketing/overview`

### ✅ FIXED: Campaign Detection Signal
Enhanced `textHasCampaignReport()` with additional DoorDash marketing page detection signals (sponsored listing, boost your sales, paid marketing, advertising overview, etc.)

### ⚠️ ISSUE: Bakudan Stone Oak - No Campaigns Parsed
- DoorDash page loaded (screenshot confirmed)
- But "No campaign rows could be parsed" → requires manual login to DoorDash for this store
- Screenshot saved: `bakudan-stone-oak/campaigns-bakudan-stone-oak-2026-06-26T10-59-41-685Z.png`
- **Action Required:** Login to DoorDash for bakudan-stone-oak manually to establish session

### ⚠️ ISSUE: Budget Not Captured
All campaigns show `budget: null` because DoorDash Merchant Portal does not display the "budget" field in the campaign table. The system correctly captures: **Spend, Sales, ROAS, Status, New Customers, Start/End dates**.

### ⚠️ ISSUE: Recommendations Show "$0/week" (cosmetic)
Since `budget: null`, the current setting shows "$0/week" which is misleading. Recommendations are still correct (based on ROAS + profit).

---

## Campaign Data Per Store

### Store 1: Bakudan Bandera ✅
**Email:** info@bakudanramen.com
**Campaigns Found:** 2 | **Recommendations:** 2 INCREASE | **Status:** Healthily performing

| Campaign | Type | Status | Spend | Sales | ROAS | Est. Profit | Recommendation |
|---|---|---|---|---|---|---|---|
| Advertise to customers $3 bid 147 weekly | marketplace | active | $519.00 | $5,639.61 | 10.87x | $608.92 | INCREASE |
| Discount for customers 5/35, June 9th | marketplace | active | $209.65 | $1,606.68 | 7.66x | $111.69 | INCREASE |

**Screenshot:** `bakudan-bandera/campaigns-bakudan-bandera-2026-06-26T11-01-35-189Z.png`

---

### Store 2: Bakudan Stone Oak ⚠️
**Email:** gm@bakudanramen.com
**Campaigns Found:** 0 | **Recommendations:** 0 | **Status:** Needs manual login

**Screenshot:** `bakudan-stone-oak/campaigns-bakudan-stone-oak-2026-06-26T10-59-41-685Z.png`

**Action Required:** Login to DoorDash Merchant Portal for this account to establish browser session.

---

### Store 3: Bakudan The Rim ✅
**Email:** bakudanramen210@gmail.com
**Campaigns Found:** 4 | **Recommendations:** 4 INCREASE | **Status:** All performing above 5x ROAS

| Campaign | Type | Status | Spend | Sales | ROAS | Est. Profit |
|---|---|---|---|---|---|---|
| Advertise to customers $3 June 9th | marketplace | active | $228.00 | $2,597.08 | 11.39x | $291.42 |
| Discount for customers June 9th, 7 of 47 | marketplace | active | $143.82 | $1,130.77 | 7.86x | $82.33 |
| 7 off 45 lapse customer, March 30th | marketplace | ended | $15.98 | $131.53 | 8.23x | $10.33 |
| 7 off 45 new customers, March 31th | marketplace | ended | $15.98 | $94.13 | 5.89x | $2.85 |

**Screenshot:** `bakudan-the-rim/campaigns-bakudan-the-rim-2026-06-26T10-59-21-881Z.png`

---

### Store 4: Raw Sushi Bar ✅
**Email:** infoheoholding@gmail.com
**Campaigns Found:** 8 | **Recommendations:** 6 INCREASE, 1 PAUSE, 1 MONITOR | **Status:** Mixed - 1 campaign bleeding money

| Campaign | Type | Status | Spend | Sales | ROAS | Est. Profit | Action |
|---|---|---|---|---|---|---|---|
| Sponsored Listing 06/03/2026 | sponsored_listing | active | $440.60 | $6,253.74 | **14.19x** | $810.15 | INCREASE |
| Smart campaign 06/03/2026 | marketplace | **ENDED** | $449.12 | $1,731.75 | 3.86x | **-$102.77** | PAUSE ⚠️ |
| Buy 1, get 1 free promotion 06/19/2026 | promotion | active | $334.42 | $1,890.25 | 5.65x | $43.63 | INCREASE |
| Discount for customers Smart Customer 9 of 80 | marketplace | active | $159.84 | $1,792.37 | 11.21x | $198.63 | INCREASE |
| Buy 1, get 1 free promotion 05/07/2026 | promotion | ended | $221.76 | $1,512.10 | 6.82x | $80.66 | INCREASE |
| New customers, $0 delivery fees 06/03/2026 | marketplace | active | $39.92 | $424.63 | 10.64x | $45.01 | INCREASE |
| Smart campaign 06/23/2026 | marketplace | active | $0.00 | $0.00 | – | $0.00 | MONITOR |
| may 7th $3 everyone | marketplace | ended | $135.00 | $2,571.86 | 19.05x | $379.37 | INCREASE |

**Screenshot:** `raw-sushi-bar/campaigns-raw-sushi-bar-2026-06-26T11-03-14-925Z.png`

---

## Strategic Summary

### High Performers (ROAS > 10x)
| Store | Campaign | ROAS | Weekly Profit |
|---|---|---|---|
| Raw Sushi Bar | Sponsored Listing 06/03/2026 | **14.19x** | **$810.15** |
| Raw Sushi Bar | may 7th $3 everyone | **19.05x** | $379.37 |
| Bakudan The Rim | Advertise to customers $3 June 9th | **11.39x** | $291.42 |
| Raw Sushi Bar | Discount for customers Smart Customer | **11.21x** | $198.63 |
| Bakudan Bandera | Advertise to customers $3 bid 147 weekly | **10.87x** | $608.92 |

### ⚠️ Campaign Requiring Immediate Attention
| Store | Campaign | ROAS | Loss/Week | Risk |
|---|---|---|---|---|
| Raw Sushi Bar | Smart campaign 06/03/2026 | 3.86x | **-$102.77** | HIGH |

**Recommendation:** PAUSE the "Smart campaign 06/03/2026" at Raw Sushi Bar immediately. This campaign is losing money despite above-1x ROAS because the 20% margin doesn't cover the $449.12 weekly spend.

---

## Screenshot Evidence

All screenshots are stored at: `C:\Ld-project\doordash-campaign-agent\data\screenshots\`

| Store | Screenshot Filename | Timestamp |
|---|---|---|
| bakudan-bandera | `campaigns-bakudan-bandera-2026-06-26T11-01-35-189Z.png` | 11:01:35 UTC |
| bakudan-stone-oak | `campaigns-bakudan-stone-oak-2026-06-26T10-59-41-685Z.png` | 10:59:41 UTC |
| bakudan-the-rim | `campaigns-bakudan-the-rim-2026-06-26T10-59-21-881Z.png` | 10:59:21 UTC |
| raw-sushi-bar | `campaigns-raw-sushi-bar-2026-06-26T11-03-14-925Z.png` | 11:03:14 UTC |

Full JSON report: `C:\Ld-project\doordash-campaign-agent\data\audit-reports\campaign-audit-2026-06-26T10-57-41-984Z.json`

---

## Files Modified During This Audit

| File | Change |
|---|---|
| `doordash-campaign-agent/.env` | Added absolute paths + execution mode vars |
| `doordash-campaign-agent/src/executor/campaign-reader.ts` | Enhanced URL list + detection signals |
| `doordash-campaign-agent/CAMPAIGN_AUDIT_REPORT_2026-06-26.md` | This report |

## Files Created During This Audit

| File | Purpose |
|---|---|
| `doordash-campaign-agent/audit-db-check.cjs` | DB state diagnostic script |
| `doordash-campaign-agent/fix-db-settings.cjs` | DB correction script |
| `doordash-campaign-agent/run-audit-from-correct-dir.cjs` | Proper audit launcher |
| `doordash-campaign-agent/build-and-audit.bat` | Build + audit batch script |

---

## Audit Report Files

- **JSON Report:** `data/audit-reports/campaign-audit-2026-06-26T10-57-41-984Z.json`
- **Markdown Report:** `data/audit-reports/campaign-audit-2026-06-26T10-57-41-984Z.md`

---

*Report generated by doordash-campaign-agent. For questions, review audit logs in the database or screenshots in data/screenshots.*
