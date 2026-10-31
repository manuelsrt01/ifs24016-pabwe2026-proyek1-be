# Rancangan Database SQLite / libSQL

Library: **`@libsql/client`** (driver libSQL, SQLite yang kompatibel). Satu kode untuk dua mode:
- **Lokal / Docker:** file SQLite (`DB_PATH`), memakai binding native libSQL (jalan di Bun maupun Node).
- **Produksi serverless (Vercel):** database **Turso** (`TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`) lewat klien web murni JavaScript. Data persisten dan dipakai bersama oleh semua instance fungsi.

`src/db/connection.js` adalah satu-satunya tempat yang memilih driver dan membungkusnya menjadi antarmuka `prepare(sql).get/all/run(...)` yang **semuanya async**, plus `exec`, `batch`, dan `transaction(async (tx) => …)`. Semua service menerima `db` atau `tx` yang berantarmuka sama.

## Tabel

**users** (migrasi v2): `id` PK · `name` NOT NULL · `email` NOT NULL **UNIQUE** (tidak peka huruf besar/kecil) · `password_hash` (`scrypt$salt$hash`) · `daily_goal_pages` (1–10000, default 30) · `created_at` · `updated_at`.
**sessions** (v2): `id` PK = SHA-256 dari token cookie (token mentah tidak disimpan) · `user_id` FK → `users(id)` ON DELETE CASCADE · `created_at` · `expires_at`. Sesi kedaluwarsa dibersihkan saat sesi baru dibuat.
**books.user_id** (v2): FK → `users(id)` ON DELETE CASCADE. SQLite tidak dapat menambah kolom `NOT NULL` berreferensi lewat `ALTER TABLE`, jadi kolom ini nullable di tingkat database dan **selalu diisi oleh service**; buku tanpa pemilik tidak pernah terlihat oleh pengguna mana pun.
Semua query data difilter `user_id` (reading log lewat join ke `books`). Menghapus pengguna menghapus sesi, buku, dan log-nya.

**books**: `id` PK AUTOINCREMENT · `title` NOT NULL · `author` NOT NULL · `category` · `total_pages` NOT NULL (>0) · `current_page` NOT NULL DEFAULT 0 ·
`status` NOT NULL ∈ {belum_dibaca, sedang_dibaca, selesai} · `started_at` · `finished_at` · `notes` · `created_at` · `updated_at`.
CHECK tingkat database: `0 ≤ current_page ≤ total_pages`; `(status='selesai') = (current_page = total_pages)`; `belum_dibaca ⇒ current_page = 0`; `finished_at ⇒ status selesai`.

**reading_logs**: `id` PK · `book_id` NOT NULL FK → `books(id)` **ON DELETE CASCADE** · `log_date` NOT NULL · `start_page` ≥ 0 · `end_page` ≥ `start_page` ·
`pages_read` = `end_page − start_page` (CHECK) · `duration_minutes` > 0 · `notes` · `created_at` · `updated_at`.

Relasi: satu buku → banyak reading log. **Strategi hapus:** menghapus buku ikut menghapus log-nya (cascade) agar tidak ada log yatim; UI meminta konfirmasi.
Aturan lintas tabel (`end_page ≤ total_pages`, sinkronisasi progres) dijaga di service dalam satu transaksi.

Indeks: `books(status)`, `books(category)`, `books(user_id)`, `reading_logs(book_id)`, `reading_logs(log_date)`, `sessions(user_id)`, `sessions(expires_at)`.

## Inisialisasi & migrasi

- `PRAGMA foreign_keys = ON` dijalankan eksplisit pada setiap koneksi; `journal_mode = WAL` untuk file database.
- Migrasi dicatat di tabel `schema_migrations` (`src/db/schema.js`); dijalankan otomatis saat server start, aman diulang, dan aman bila dua instance mulai bersamaan. Database lama berbasis `PRAGMA user_version` tetap diakui. Perubahan skema = tambah entri baru.
- Database **tidak pernah** dihapus/di-reset saat start. Seed demo hanya lewat `npm run seed` (menolak bila `NODE_ENV=production` atau database sudah berisi buku).
- Semua query memakai parameter terikat (`?`); karakter `%`/`_` pada pencarian di-escape.
- WAL memerlukan filesystem lokal pada disk persisten (hindari network filesystem).
