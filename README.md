# TanaRead API (Back-end)

REST API untuk aplikasi TanaRead: **Express 5 + SQLite/libSQL** (`@libsql/client`): file lokal saat pengembangan, **Turso** (SQLite di cloud) di produksi. Dijalankan dengan **Bun** (atau Node 22+; di Vercel sebagai fungsi serverless lewat `api/index.js`).
Front-end ada di repository terpisah: `ifs24016-pabwe2026-proyek1`.

## Struktur

```
ifs24016-pabwe2026-proyek1-backend/
├── src/{config,db,middleware,routes,services,utils,validators}, app.js, server.js
├── api/index.js      # pintu masuk serverless untuk Vercel
├── tests/            # bun test
├── docs/             # API, DATABASE, DEPLOYMENT
└── Dockerfile, vercel.json, .env.example
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
| `TURSO_DATABASE_URL` | (kosong) | URL database Turso (`libsql://nama-db.turso.io`). Bila diisi, dipakai menggantikan `DB_PATH` |
| `TURSO_AUTH_TOKEN` | (kosong) | Token akses database Turso (wajib bila `TURSO_DATABASE_URL` diisi) |
| `DB_PATH` | `data/tanaread.db` | File SQLite lokal bila Turso tidak dipakai (Docker: disk persisten, mis. `/data/tanaread.db`) |
| `DEMO_SEED` | (kosong) | `true` = buat akun demo otomatis (hanya `api/index.js` di Vercel) |
| `APP_TIMEZONE` | Asia/Jakarta | Menentukan "hari ini" untuk statistik |
| `CORS_ORIGIN` | http://localhost:5173 | Origin front-end yang diizinkan |
| `COOKIE_SECURE` | `true` di produksi | Cookie sesi `Secure` (butuh HTTPS) |
| `TRUST_PROXY` | 0 | Isi `1` bila di belakang reverse proxy/PaaS |

## Dokumentasi

[API](docs/API.md) · [Database](docs/DATABASE.md) · [Deployment](docs/DEPLOYMENT.md)
