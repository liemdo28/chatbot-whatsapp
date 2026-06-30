# Review Auto-Bridge

Service wrapper trong `C:\Ld-project\review-auto-bridge\` bổ sung 4 tính năng cho project `review-automation-system` (gốc ở `C:\Users\hoang\Downloads\source\setup-all\Bakudan\review-automation-system`):

1. ✅ Cài đặt trong `C:\Ld-project` và chạy được ngay lập tức (Node 24, không cần Docker/Postgres/Redis)
2. ✅ Dashboard trực quan theo dõi reviews + scheduler + activity log
3. ✅ Auto-pull + auto-reply mỗi **Thứ 2** và **Thứ 5** lúc 08:00 PT (cron `0 8 * * 1,4`)
4. ✅ CEO Approval Queue với edit / approve / reject từng review
5. ✅ **LIVE mode** — kết nối Google Business Profile API thật, fetch reviews + post replies

## Cài đặt & chạy

```bash
# Lần đầu
cd C:\Ld-project\review-auto-bridge
npm install

# Khởi động server
node main.js
# hoặc click start.bat
```

Server listen tại `http://localhost:8787`.

## URLs

| URL | Mô tả |
|---|---|
| `http://localhost:8787/` | Dashboard tổng quan |
| `http://localhost:8787/approval` | CEO Approval Queue |
| `http://localhost:8787/api/health` | Health check (trả về `mode: LIVE` hoặc `DRY_RUN`) |
| `http://localhost:8787/api/stats` | Stats JSON |
| `http://localhost:8787/api/reviews` | Tất cả reviews |
| `http://localhost:8787/api/approval-queue` | CEO queue |
| `http://localhost:8787/api/activity-log` | Log các action |
| `http://localhost:8787/api/gbp/connection` | Test GBP API connection |

## LIVE Mode (Google Business Profile API)

Hệ thống kết nối **Google Business Profile API thật** qua service account credentials, fetch reviews từ tất cả locations, và post replies trực tiếp lên Google.

### Cấu hình credentials

File `.env` (đã có sẵn) điều khiển credentials path. Auto-resolve theo thứ tự:
1. `GOOGLE_APPLICATION_CREDENTIALS` env var
2. `./mi-gbp-service-account.json` (trong review-auto-bridge)
3. `../whatsapp-ai-gateway/mi-gbp-service-account.json` (share với whatsapp-ai-gateway)
4. `C:\Users\hoang\Downloads\source\mi-gbp-service-account.json` (dev default)

Service account cần scope: `https://www.googleapis.com/auth/business.manage`

### Mode & chế độ chạy

Trong `data/store.json` → `config`:

```json
{
  "dry_run": false,        // false = LIVE, true = chỉ generate reply nhưng KHÔNG post
  "auto_reply_enabled": true,
  "min_rating_auto": 4,    // auto-reply nếu rating >= 4 và không có risk flag
  "scheduler_days": ["1", "4"],
  "scheduler_time": "08:00"
}
```

- `dry_run: true` → gọi là **DRY RUN** — generate reply nhưng KHÔNG post lên Google
- `dry_run: false` → gọi là **LIVE** — post reply thật lên Google Business Profile

Đổi mode runtime qua API:

```bash
curl -X POST http://localhost:8787/api/config \
  -H "Content-Type: application/json" \
  -d '{"dry_run": false}'
```

## Quy tắc auto-reply

| Rating | Risk | Hành động |
|---|---|---|
| 5★ | None | **Auto-reply** (gửi ngay nếu `dry_run=false`) |
| 4★ | None | **Auto-reply** |
| 4★ | Có risk keyword (e.g. "wait time") | CEO queue |
| 3★ | Any | CEO queue |
| 1-2★ | Any | CEO queue |
| Any | Hard-block keyword (allergy, food poisoning, lawsuit, refund...) | CEO queue |

Config ở `data/store.json` → `config.min_rating_auto` (mặc định 4).

## Files

- `main.js` — Express server + API endpoints (async, loads .env)
- `scheduler.js` — node-cron, mặc định thứ 2 + thứ 5
- `scraper.js` — **NEW** Google Business Profile API scraper (replaces mock data)
- `auto-reply.js` — Async auto-reply cycle using scraper
- `db.js` — JSON-based store (không cần DB)
- `data/store.json` — Toàn bộ state (reviews, queue, log, config)
- `public/index.html` — Dashboard
- `public/approval.html` — CEO approval UI
- `.env` — Runtime config (credentials path, mode, thresholds)
- `start.bat` — Windows one-click launcher
- `run-test.ps1` — End-to-end smoke test

## Run ngay (LIVE)

```powershell
# PowerShell
cd C:\Ld-project\review-auto-bridge
npm install        # chỉ lần đầu
node main.js       # hoặc .\start.bat
```

Sau khi chạy:
- Dashboard: http://localhost:8787/
- CEO Queue: http://localhost:8787/approval
- Health: `{"status":"ok","mode":"LIVE"}`
- Test GBP: `curl http://localhost:8787/api/gbp/connection`

## Smoke test

```powershell
.\run-test.ps1
```

Test results expected:
- Server starts on port 8787
- `/api/health` returns `{"status":"ok","mode":"LIVE"}`
- `/api/gbp/connection` returns `{"ok":true,"locationCount":N}`
- Scheduler runs at next Mon/Thu 08:00 PT