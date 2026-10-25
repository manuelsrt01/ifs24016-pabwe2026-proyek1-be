# TanaRead API (Back-end)

REST API untuk aplikasi TanaRead: **Express 5 + SQLite (`bun:sqlite`)**, dijalankan dengan **Bun**.
Front-end ada di repository terpisah: `ifs24016-pabwe2026-proyek1`.

## Struktur

```
ifs24016-pabwe2026-proyek1-backend/
├── src/{config,db,middleware,routes,services,utils,validators}, app.js, server.js
├── tests/            # bun test
├── docs/             # API, DATABASE, DEPLOYMENT
└── Dockerfile, .env.example
```

## Menjalankan lokal (Windows PowerShell)

```powershell
git clone <URL_REPOSITORY_BACKEND>
cd ifs24016-pabwe2026-proyek1-backend
bun install
Copy-Item .env.example .env
bun run db:init      # opsional; otomatis saat server start
bun run seed         # opsional: akun demo demo@tanaread.test / demo12345 (jangan di produksi)
bun run dev          # http://localhost:3000
```

Cek: `Invoke-RestMethod http://localhost:3000/api/health` → `status: ok`.

## Test

```powershell
bun run test
```

## Environment (`.env`)

| Variabel | Default | Keterangan |
|---|---|---|
| `PORT` | 3000 | Port server |
| `DB_PATH` | `data/tanaread.db` | Lokasi file SQLite (produksi: disk persisten, mis. `/data/tanaread.db`) |
| `APP_TIMEZONE` | Asia/Jakarta | Menentukan "hari ini" untuk statistik |
| `CORS_ORIGIN` | http://localhost:5173 | Origin front-end yang diizinkan |
| `COOKIE_SECURE` | `true` di produksi | Cookie sesi `Secure` (butuh HTTPS) |
| `TRUST_PROXY` | 0 | Isi `1` bila di belakang reverse proxy/PaaS |

## Dokumentasi

[API](docs/API.md) · [Database](docs/DATABASE.md) · [Deployment](docs/DEPLOYMENT.md)
