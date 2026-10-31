# Deployment Back-end

Ada dua cara menjalankan back-end ini. Pilih salah satu.

## A. Vercel + Turso (tanpa kartu kredit, data persisten)

Vercel tidak punya disk persisten, jadi database ditaruh di **Turso** (SQLite di cloud, ada paket gratis). Satu database dipakai bersama oleh semua instance fungsi, sehingga daftar → login → data tetap konsisten.

1. **Push** repo back-end ke GitHub (pastikan `api/index.js`, `vercel.json`, dan `bun.lock` ikut ter-commit; jalankan `bun install` dulu agar `bun.lock` memuat `@libsql/client`).
2. Di Vercel: **Add New → Project**, pilih repo back-end, Framework Preset **Other**, biarkan build command kosong. Deploy sekali.
3. Di dashboard proyek: **Storage** (atau **Marketplace**) → **Turso Cloud** → buat database dan **hubungkan ke proyek ini**. Integrasi akan menambahkan environment variable `TURSO_DATABASE_URL` dan `TURSO_AUTH_TOKEN` secara otomatis. Bila namanya berbeda, tambahkan keduanya manual di **Settings → Environment Variables** (URL berbentuk `libsql://nama-db.turso.io`, token dari dashboard Turso).
4. Tambahkan environment variable lain: `NODE_ENV=production` dan `TRUST_PROXY=1`.
5. **Redeploy** (Deployments → titik tiga → Redeploy) agar variabel terbaca.
6. Cek `https://<nama-backend>.vercel.app/api/health` → `{"status":"ok","database":"ok"}`. Tabel dibuat otomatis oleh migrasi saat fungsi pertama kali jalan.
7. Isi host back-end ke `vercel.json` di repository front-end (`"destination": "https://<nama-backend>.vercel.app/api/:path*"`).

Tanpa `TURSO_*`, `api/index.js` jatuh ke file SQLite di `/tmp` yang **sementara** (hilang saat fungsi tidur). Itu hanya cocok untuk percobaan.

Opsional: `DEMO_SEED=true` membuat akun `demo@tanaread.test` / `demo12345` bila belum ada. Jangan diaktifkan bila tidak perlu.

## B. Docker dengan disk persisten

SQLite adalah **satu file**, jadi tempat hosting harus menyediakan: menjalankan proses/Docker, **disk persisten** di `/data`, HTTPS, dan environment variables.
Filesystem ephemeral tidak boleh menyimpan database produksi. Jalankan **satu instance** saja.

1. Pastikan `bun.lock` ter-commit (hasil `bun install`).
2. Buat Web Service dari repository ini memakai `Dockerfile` di root.
3. Pasang disk/volume persisten dengan mount path `/data`.
4. Environment: `NODE_ENV=production`, `DB_PATH=/data/tanaread.db`, `APP_TIMEZONE=Asia/Jakarta`, `TRUST_PROXY=1`.
5. Health check: `/api/health`.
6. Catat URL HTTPS hasil deploy, lalu isikan host-nya ke `vercel.json` di repository front-end.

### Menjalankan sendiri di server/VPS

```bash
docker build -t ifs24016-pabwe2026-proyek1-backend .
docker run -d --name proyek1-api --restart unless-stopped -p 3000:3000 -v proyek1-data:/data ifs24016-pabwe2026-proyek1-backend
curl http://localhost:3000/api/health
```

Jika muncul *unable to open database file*, kepemilikan volume tidak sesuai dengan user `bun`; sesuaikan izin volume.
Jangan menjalankan `bun run seed` di produksi.
