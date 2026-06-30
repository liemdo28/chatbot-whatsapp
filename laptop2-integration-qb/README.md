# Laptop2 — Integration-QB Stack

> Bản copy từ laptop1 của project Integration-QB + 3 service hỗ trợ. **Chỉ cần 1 cú click để cài đặt**, kết nối Mi-Core **giống hệt laptop1**.

## Quick Start (3 bước)

```bat
REM Bước 1: Copy folder "laptop2-integration-qb" sang laptop2
REM Bước 2: Mở CMD trong folder, chạy:
INSTALL-ONE-CLICK.bat

REM Bước 3: Sau khi cài xong, khởi động tất cả:
START-ALL.bat

REM Bước 4 (tùy chọn): Verify kết nối Mi-Core
VERIFY-INSTALL.bat
```

## Bao gồm 4 service

| Service | Port | Mục đích |
|---------|------|----------|
| **qb-ops-agent** | 3457 | QuickBooks Desktop monitor + SOAP server cho QBWC |
| **mi-node-agent** | 4100 | Node controller cho Mi-Core (NODE_ID=laptop2) |
| **whatsapp-ai-gateway** | 3212 | Food safety chatbot |
| **doordash-agent** | 3461 | DoorDash scraper (Playwright) |

## Thông tin kết nối Mi-Core (giống laptop1)

```
MI_CORE_URL=http://100.118.102.113:4001
MI_CORE_API_KEY=b149c4783a1109ff46d01498d91766e7
```

## Khác biệt so với laptop1

| | Laptop1 | Laptop2 |
|---|---|---|
| NODE_ID | `laptop1` | **`laptop2`** |
| MACHINE_ID (QB) | `qb-laptop-01` | **`qb-laptop-02`** |
| whatsapp port | 3210/3211 | **3212** |
| doordash port | 3460 | **3461** |

## Xem chi tiết

Đọc file [`LAPTOP2_INSTALL.md`](LAPTOP2_INSTALL.md) để biết:
- Cách cài thủ công
- Cách verify sau cài
- Troubleshooting
- Cấu hình nâng cao

---

**Build date:** 2026-06-30  
**Source:** `C:\Users\hoang\Downloads\source` (laptop1)  
**Compatible with:** Windows 10/11 + Node.js 18+