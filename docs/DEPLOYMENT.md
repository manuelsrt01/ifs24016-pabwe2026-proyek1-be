# Deployment Back-end

SQLite adalah **satu file**, jadi tempat hosting harus menyediakan: menjalankan proses/Docker, **disk persisten** di `/data`, HTTPS, dan environment variables.
Filesystem ephemeral tidak boleh menyimpan database produksi. Jalankan **satu instance** saja.

## Langkah umum (Docker)

1. Pastikan `bun.lock` ter-commit (hasil `bun install`).
2. Buat Web Service dari repository ini memakai `Dockerfile` di root.
3. Pasang disk/volume persisten dengan mount path `/data`.
4. Environment: `NODE_ENV=production`, `DB_PATH=/data/tanaread.db`, `APP_TIMEZONE=Asia/Jakarta`, `TRUST_PROXY=1`.
5. Health check: `/api/health`.
6. Catat URL HTTPS hasil deploy, lalu isikan host-nya ke `vercel.json` di repository front-end.

## Menjalankan sendiri di server/VPS

```bash
docker build -t ifs24016-pabwe2026-proyek1-backend .
docker run -d --name proyek1-api --restart unless-stopped -p 3000:3000 -v proyek1-data:/data ifs24016-pabwe2026-proyek1-backend
curl http://localhost:3000/api/health
```

Jika muncul *unable to open database file*, kepemilikan volume tidak sesuai dengan user `bun`; sesuaikan izin volume.
Jangan menjalankan `bun run seed` di produksi.
