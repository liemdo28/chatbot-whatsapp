# LAPTOP2 — Integration-QB Install Guide

> **Mục đích:** Bản copy của `qb-ops-agent` + `mi-node-agent` + `whatsapp-ai-gateway` + `doordash-agent` từ laptop1, **kết nối Mi-Core giống hệt laptop1**.

---

## 1. Thông tin kết nối (đã copy từ laptop1)

| Item | Giá trị | Ghi chú |
|------|---------|---------|
| Mi-Core URL | `http://100.118.102.113:4001` | Giống laptop1 |
| Mi-Core API Key (QB) | `b149c4783a1109ff46d01498d91766e7` | Giống laptop1 — dùng cho `/api/qb-agent/*` |
| QBWC Endpoint (laptop2) | `http://localhost:3457/qbwc` | QuickBooks Web Connector sẽ trỏ vào đây |
| QBWC Username | `mi-qb-agent` | Giống laptop1 |
| QBWC Password | `b149c4783a1109ff46d01498d91766e7` | Giống laptop1 |
| NODE_ID | `laptop2` | **KHÁC laptop1** (laptop1 = `laptop1`) |
| NODE_SECRET | *cần đổi* | CEO sẽ cấp riêng |
| Dashboard endpoint | `https://dashboard.bakudanramen.com/api` | Giống laptop1 |

## 2. Khác biệt so với laptop1

| Service | Port laptop1 | Port laptop2 |
|---------|--------------|--------------|
| whatsapp-ai-gateway | 3210 / 3211 | **3212** |
| doordash-agent | 3460 | **3461** |
| mi-node-agent | 4100 | 4100 (giống) |
| qb-ops-agent SOAP | 3457 | 3457 (giống) |
| MACHINE_ID (trên Mi-Core) | `qb-laptop-01` | **`qb-laptop-02`** |

## 3. Cài đặt (1-CLICK)

### Yêu cầu trước khi cài
- **Node.js 18+** đã cài đặt: https://nodejs.org
- **Kết nối mạng** tới Mi-Core PC (`100.118.102.113:4001`)
- Windows 10/11 với quyền user (không cần admin)

### Bước 1 — Copy folder sang laptop2
Copy toàn bộ thư mục `laptop2-integration-qb/` vào laptop2 (qua USB, OneDrive, hoặc share network).

### Bước 2 — Cài dependencies
Mở Command Prompt trong thư mục `laptop2-integration-qb`, chạy:

```bat
INSTALL-ONE-CLICK.bat
```

Script sẽ tự động:
- Tạo folder `data/` và `logs/`
- `npm install` cho 4 services
- `npm run build` cho qb-ops-agent và mi-node-agent
- Cài Playwright Chromium cho doordash-agent

### Bước 3 — Kiểm tra NODE_SECRET
Mở file `mi-node-agent\.env`, thay giá trị `NODE_SECRET`:
- CEO sẽ cấp secret riêng cho laptop2
- Báo lại CEO để add vào Mi-Core danh sách allowed nodes
- Format: chuỗi hex/random 32-64 ký tự

### Bước 4 — Khởi động
```bat
START-ALL.bat
```

Script khởi động 4 services theo thứ tự:
1. **mi-node-agent** (port 4100) — Mi-Core sẽ thấy "laptop2" online
2. **qb-ops-agent** (port 3457) — gửi heartbeat + workflow về Mi-Core
3. **whatsapp-ai-gateway** (port 3212) — food safety chatbot
4. **doordash-agent** (port 3461) — DoorDash scraper

### Bước 5 — Verify
```bat
VERIFY-INSTALL.bat
```

Script sẽ kiểm tra 8 thứ:
1. ✅ Mi-Core PC có sống không
2. ✅ mi-node-agent listening port 4100
3. ✅ qb-ops-agent listening port 3457
4. ✅ whatsapp-ai-gateway listening port 3212
5. ✅ doordash-agent listening port 3461
6. ✅ `qb-laptop-02` đã heartbeat Mi-Core
7. ✅ `laptop2` đã register với Mi-Core
8. ✅ WSDL endpoint sẵn sàng cho QuickBooks

### Bước 6 — Trỏ QuickBooks Web Connector
Mở QuickBooks Web Connector trên laptop2:
- **App URL:** `http://localhost:3457/qbwc`
- **Username:** `mi-qb-agent`
- **Password:** `b149c4783a1109ff46d01498d91766e7`

Bấm **Update Selected** để trigger sync đầu tiên.

## 4. Các lệnh thường dùng

| Lệnh | Mục đích |
|------|----------|
| `INSTALL-ONE-CLICK.bat` | Cài đặt tất cả (npm install + build) |
| `START-ALL.bat` | Khởi động 4 services |
| `STOP-ALL.bat` | Dừng tất cả services |
| `VERIFY-INSTALL.bat` | Kiểm tra kết nối Mi-Core |
| `QB-START.bat` | Chỉ khởi động qb-ops-agent |
| `MI-START.bat` | Chỉ khởi động mi-node-agent |
| `QB-VERIFY.bat` | Kiểm tra QB Mirror sync-log & summary từ Mi-Core |

## 5. Xem log

| File log | Service |
|----------|---------|
| `logs\mi-node-agent.out.log` | mi-node-agent stdout/stderr |
| `logs\qb-ops-agent.out.log` | qb-ops-agent stdout/stderr |
| `logs\whatsapp-ai-gateway.out.log` | whatsapp-ai-gateway stdout/stderr |
| `logs\doordash-agent.out.log` | doordash-agent stdout/stderr |
| `qb-ops-agent\logs\*.log` | qb-ops-agent winston logs (rotation) |
| `whatsapp-ai-gateway\logs\*.log` | gateway winston logs |

## 6. Kiến trúc tổng quan

```
┌──────────────────── LAPTOP2 ──────────────────────────┐
│                                                       │
│  qb-ops-agent (3457)  ──┐                             │
│                          │                             │
│  mi-node-agent (4100)  ─┤   ┌──────────────────────┐ │
│                          ├──▶│ MI_CORE_URL          │ │
│  whatsapp-gateway(3212) ┤   │ 100.118.102.113:4001 │ │
│                          │   │ (Mi-Core PC - giống  │ │
│  doordash-agent (3461) ──┘   │  laptop1)            │ │
│                              └──────────────────────┘ │
│                                                       │
│  QuickBooks Desktop ◀── Web Connector ──── :3457     │
└───────────────────────────────────────────────────────┘
```

## 7. Troubleshooting

### Service không lên sau `START-ALL.bat`
- Kiểm tra `logs\<service>.out.log` xem lỗi gì
- Kiểm tra port đã bị chiếm: `netstat -aon | findstr :<port>`
- Chạy `VERIFY-INSTALL.bat` để xem chi tiết

### Mi-Core không thấy `laptop2`
- Kiểm tra `mi-node-agent\.env`: `MI_CORE_URL=http://100.118.102.113:4001`
- Test thủ công: `curl http://100.118.102.113:4001/api/health`
- Nếu fail → kiểm tra Tailscale/firewall

### QuickBooks không sync
- Mở QuickBooks Web Connector → kiểm tra App URL = `http://localhost:3457/qbwc`
- Username/password = `mi-qb-agent` / `b149c4783a1109ff46d01498d91766e7`
- Bấm "Update Selected" → xem log có lỗi gì

### `qb-laptop-02` không xuất hiện trên Mi-Core
- Kiểm tra `qb-ops-agent\.env`: `MACHINE_ID=qb-laptop-02`
- Heartbeat mỗi 60s, đợi 1-2 phút
- Check log: `logs\qb-ops-agent.out.log` xem có lỗi gì

## 8. Phần mềm đã tích hợp

| Phần mềm | Mục đích | Port |
|----------|----------|------|
| Node.js 18+ | Runtime cho tất cả service | - |
| qb-ops-agent | QuickBooks Desktop monitor → Mi-Core | 3457 |
| mi-node-agent | Node controller cho Mi-Core | 4100 |
| whatsapp-ai-gateway | WhatsApp food safety chatbot | 3212 |
| doordash-agent | Playwright DoorDash scraper | 3461 |
| Playwright Chromium | Browser cho doordash-agent | - |
| SQLite | Local DB cho qb-ops-agent | - |

## 9. Tạo package để move qua laptop2

Nén folder `laptop2-integration-qb\` thành zip:

```powershell
Compress-Archive -Path "C:\Users\hoang\Downloads\laptop2-integration-qb" -DestinationPath "C:\Users\hoang\Desktop\laptop2-integration-qb.zip"
```

Copy zip sang laptop2 (USB / OneDrive / network share) → giải nén → chạy `INSTALL-ONE-CLICK.bat`.

---

**Tạo:** 2026-06-30  
**Từ:** Source laptop1 (`C:\Users\hoang\Downloads\source`)  
**Stack:** giống laptop1, port khác, NODE_ID khác, MACHINE_ID khác