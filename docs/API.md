# Dokumentasi REST API TanaRead

Base URL lokal: `http://localhost:3000/api` · Format: JSON (`Content-Type: application/json`).

## Konvensi

- Sukses: `{ "data": ... }`; daftar menyertakan `"meta"`. `DELETE` sukses → `204 No Content` tanpa body.
- Error: `{ "error": { "code": "...", "message": "...", "details": { "field": "pesan" } } }` (`details` hanya untuk validasi).
- Stack trace tidak pernah dikirim ke klien.

| Status | code | Arti |
|---|---|---|
| 200 / 201 / 204 | – | Berhasil / dibuat / dihapus |
| 400 | `INVALID_ID`, `INVALID_JSON` | ID bukan bilangan bulat positif; body bukan JSON |
| 401 | `UNAUTHORIZED` | Belum masuk / sesi tidak valid / email atau kata sandi salah |
| 409 | `CONFLICT` | Email sudah terdaftar |
| 429 | `TOO_MANY_REQUESTS` | Terlalu banyak percobaan login gagal (8 per 15 menit per email+IP) |
| 404 | `NOT_FOUND` | Resource atau endpoint tidak ada |
| 413 | `PAYLOAD_TOO_LARGE` | Body > 100 KB |
| 422 | `VALIDATION_ERROR` | Data/parameter tidak memenuhi aturan |
| 500 | `INTERNAL_ERROR` | Kesalahan server (detail hanya di log server) |
| 503 | – | `/api/health` bila database tidak dapat diakses |

## Autentikasi

Sesi memakai cookie `tanaread_session` (acak 256-bit, `HttpOnly`, `SameSite=Lax`, `Secure` di produksi, berlaku 14 hari). Yang disimpan di database hanya hash SHA-256 token. Kata sandi di-hash dengan scrypt + salt acak.
**Semua endpoint di bawah (selain `/health` dan `/auth/register|login|logout`) wajib login (401 bila tidak) dan hanya mengakses data milik pengguna yang login; data pengguna lain diperlakukan seperti tidak ada (404).**

| Metode & path | Keterangan | Sukses | Error |
|---|---|---|---|
| `POST /auth/register` | `{name,email,password}` (sandi 8–128 karakter) | 201 + `{data: user}` + cookie | 422, 409 |
| `POST /auth/login` | `{email,password}` | 200 + `{data: user}` + cookie | 422, 401, 429 |
| `POST /auth/logout` | Menghapus sesi & cookie | 204 | – |
| `GET /auth/me` | Pengguna saat ini | 200 | 401 |
| `PATCH /auth/me` | `{name?, daily_goal_pages?}` (target 1–10000) | 200 | 401, 422 |
| `DELETE /auth/me/data` | Hapus semua buku & log milik sendiri (akun tetap) | 204 | 401 |

Objek `user`: `{ id, name, email, daily_goal_pages, created_at }` (hash tidak pernah dikirim).

## Health

`GET /api/health` → `200 {"status":"ok","database":"ok","time":"..."}`

## Buku

Objek buku: `id, title, author, category, total_pages, current_page, status, started_at, finished_at, notes, created_at, updated_at, progress_percent`.
`GET /books/:id` menambah `log_summary: { sessions, total_pages_logged, total_minutes }`.

| Metode & path | Keterangan | Sukses | Error |
|---|---|---|---|
| `GET /books?q=&status=&category=` | Daftar buku; `q` mencari judul/penulis; `status` ∈ `belum_dibaca\|sedang_dibaca\|selesai` | 200 | 422 (status tidak valid) |
| `POST /books` | Tambah buku | 201 + header `Location` | 422 |
| `GET /books/:id` | Detail + ringkasan log | 200 | 400, 404 |
| `PUT /books/:id` | Ganti seluruh data buku | 200 | 400, 404, 422 |
| `DELETE /books/:id` | Hapus buku + semua log-nya (cascade) | 204 | 400, 404 |
| `GET /books/:id/logs` | Reading log milik buku (terbaru dulu) | 200 | 400, 404 |

Body `POST`/`PUT`:

```json
{
  "title": "Judul", "author": "Penulis", "category": "Fiksi",
  "total_pages": 300, "current_page": 0, "status": "belum_dibaca",
  "started_at": null, "finished_at": null, "notes": null
}
```

Aturan validasi: `title` (≤200) dan `author` (≤150) wajib; `total_pages` bilangan bulat 1–100000; `0 ≤ current_page ≤ total_pages`;
tanggal `YYYY-MM-DD` valid. **Konsistensi status–progres:** `belum_dibaca` ⇒ `current_page = 0`; `sedang_dibaca` ⇒ `current_page < total_pages`;
`selesai` ⇒ `current_page = total_pages` (otomatis bila tidak dikirim) dan `finished_at` default hari ini; `finished_at` hanya untuk status `selesai`.
Bila `status` tidak dikirim, ia diturunkan dari `current_page`. `PUT` ditolak (422) bila `total_pages` lebih kecil dari halaman akhir log yang sudah ada.

## Reading log

Objek: `id, book_id, book_title, log_date, start_page, end_page, pages_read, duration_minutes, notes, created_at, updated_at`.
`start_page` = posisi halaman saat mulai (0 = belum mulai), `end_page` = posisi saat berhenti, `pages_read = end_page − start_page` (dihitung server).

| Metode & path | Keterangan | Sukses | Error |
|---|---|---|---|
| `GET /reading-logs?book_id=&from=&to=&limit=&offset=` | Daftar log (terbaru dulu), `limit` 1–200 (default 50) | 200 + `meta {total,limit,offset}` | 422 |
| `POST /reading-logs` | Catat sesi | 201 | 422 |
| `GET /reading-logs/:id` | Detail | 200 | 400, 404 |
| `PUT /reading-logs/:id` | Ganti data log (buku tidak dapat dipindah) | 200 | 400, 404, 422 |
| `DELETE /reading-logs/:id` | Hapus log | 204 | 400, 404 |

Body: `{ "book_id": 1, "log_date": "2026-10-20", "start_page": 0, "end_page": 40, "duration_minutes": 25, "notes": "opsional" }`

Validasi: buku harus ada (422 pada `book_id`); `0 ≤ start_page ≤ end_page ≤ total_pages buku`; `duration_minutes` bilangan bulat 1–1440;
`log_date` valid dan tidak di masa depan (zona waktu `APP_TIMEZONE`).

### Aturan progres (anti penghitungan ganda)

1. Progres buku adalah **posisi** halaman, bukan penjumlahan. Saat log dibuat: `current_page = MAX(current_page, end_page)`.
   Contoh: log 0→50 lalu 20→60 menghasilkan progres 60 (bukan 110).
2. Saat log diubah/dihapus: `current_page = MAX(end_page)` dari log yang tersisa. Bila tidak ada log tersisa, progres dibiarkan.
   Catatan: jika progres diubah manual lewat form buku lalu log diedit/dihapus, progres dihitung ulang dari log.
3. `current_page = total_pages` ⇒ status `selesai`, `finished_at` = tanggal log (bila belum ada). Progres turun di bawah total ⇒ kembali `sedang_dibaca`.
4. `started_at` = tanggal paling awal antara nilai lama dan tanggal log.
5. Statistik "halaman dari log" = `SUM(pages_read)`: membaca ulang halaman yang sama tetap dihitung sebagai aktivitas, tetapi tidak menambah progres buku.

## Dashboard & statistik

`GET /dashboard/summary` →
`total_books, reading, finished, unread, pages_read (SUM current_page semua buku), pages_logged (SUM pages_read log), total_minutes, total_sessions, daily_goal_pages, today{date,pages,minutes,sessions}, last_7_days[{date,pages,minutes,sessions}], reading_books[≤5 buku berstatus sedang dibaca], recent_logs[5]`.

`GET /statistics/reading-activity?from=YYYY-MM-DD&to=YYYY-MM-DD` (default 30 hari terakhir, maks 366 hari; hari kosong diisi 0) →
`{ from, to, days[{date,pages,minutes,sessions}], totals{pages,minutes,sessions} }`. Error 422 bila tanggal salah, `from > to`, atau rentang > 366 hari.

`GET /statistics/reading-habits?days=30` (`days` 1–365 atau `all` untuk seluruh riwayat) →
`period{from,to,days,all_time}, total_pages, total_minutes, sessions, active_days, avg_minutes_per_session, avg_minutes_per_active_day, avg_minutes_per_day, avg_pages_per_active_day, consistency_ratio (hari aktif ÷ hari periode), streaks{current,longest}, finished_books[], finished_books_all_time, definitions{...}`.

`GET /statistics/categories` → `{ total_books, categories[{category,books,percent}] }` (buku tanpa kategori dikelompokkan sebagai "Tanpa kategori").
Definisi tiap metrik dikirim di field `definitions` dan ditampilkan di UI.

## Contoh pemakaian (PowerShell)

```powershell
$base = "http://localhost:3000/api"
Invoke-RestMethod "$base/health"

# Login (cookie sesi disimpan di $s)
$cred = '{"email":"demo@tanaread.test","password":"demo12345"}'   # akun dari `bun run seed`
Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType "application/json" -Body $cred -SessionVariable s
Invoke-RestMethod "$base/auth/me" -WebSession $s
# Tambahkan -WebSession $s pada semua perintah berikut

$book = Invoke-RestMethod -Method Post -Uri "$base/books" -WebSession $s -ContentType "application/json" `
  -Body '{"title":"Contoh","author":"Penulis","category":"Fiksi","total_pages":200}'
$book.data.id

Invoke-RestMethod -Method Post -Uri "$base/reading-logs" -WebSession $s -ContentType "application/json" `
  -Body ('{"book_id":' + $book.data.id + ',"log_date":"' + (Get-Date -Format yyyy-MM-dd) + '","start_page":0,"end_page":40,"duration_minutes":25}')

Invoke-RestMethod "$base/dashboard/summary" -WebSession $s
Invoke-RestMethod "$base/statistics/reading-habits?days=7" -WebSession $s
Invoke-RestMethod -Method Delete -Uri "$base/books/$($book.data.id)" -WebSession $s
```

## Contoh pemakaian (curl, bash/Git Bash)

```bash
curl -s http://localhost:3000/api/health
curl -s -i http://localhost:3000/api/books                  # 401 (belum login)
curl -s -c cookies.txt -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"demo@tanaread.test","password":"demo12345"}'
curl -s -b cookies.txt -X POST http://localhost:3000/api/books -H "Content-Type: application/json" \
  -d '{"title":"Contoh","author":"Penulis","total_pages":200}'
curl -s -b cookies.txt -i http://localhost:3000/api/books/99999   # 404
curl -s -b cookies.txt -X POST http://localhost:3000/api/books -H "Content-Type: application/json" -d '{"title":""}'   # 422
```
