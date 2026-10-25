import { inTransaction } from '../db/connection.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { validateBookInput } from '../validators/book.js';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export function decorate(row) {
  if (!row) return null;
  const book = { ...row };
  delete book.user_id;
  book.progress_percent = book.total_pages > 0
    ? Math.round((book.current_page / book.total_pages) * 1000) / 10
    : 0;
  return book;
}

function escapeLike(text) {
  return text.replace(/[\\%_]/g, '\\$&');
}

export function listBooks(db, userId, { q, status, category } = {}) {
  const where = ['user_id = ?'];
  const params = [userId];
  if (q) {
    where.push("(title LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\')");
    const like = `%${escapeLike(q)}%`;
    params.push(like, like);
  }
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (category) {
    where.push('category = ?');
    params.push(category);
  }
  const sql = `SELECT * FROM books WHERE ${where.join(' AND ')} ORDER BY updated_at DESC, id DESC`;
  return db.prepare(sql).all(...params).map(decorate);
}

/** Mengambil baris buku MILIK pengguna; buku milik orang lain diperlakukan sama seperti tidak ada (404). */
function findBookRow(db, userId, id) {
  const row = db.prepare('SELECT * FROM books WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) throw new NotFoundError('Buku');
  return row;
}

export function getBook(db, userId, id) {
  const book = decorate(findBookRow(db, userId, id));
  const summary = db
    .prepare(
      `SELECT COUNT(*) AS sessions,
              COALESCE(SUM(pages_read), 0) AS total_pages_logged,
              COALESCE(SUM(duration_minutes), 0) AS total_minutes
         FROM reading_logs WHERE book_id = ?`,
    )
    .get(id);
  return { ...book, log_summary: { ...summary } };
}

export function createBook(db, userId, raw, { today }) {
  const b = validateBookInput(raw, { today });
  const result = db
    .prepare(
      `INSERT INTO books (user_id, title, author, category, total_pages, current_page, status, started_at, finished_at, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, b.title, b.author, b.category, b.total_pages, b.current_page, b.status, b.started_at, b.finished_at, b.notes);
  return getBook(db, userId, Number(result.lastInsertRowid));
}

export function updateBook(db, userId, id, raw, { today }) {
  findBookRow(db, userId, id);
  const b = validateBookInput(raw, { today });
  const { maxEnd } = db
    .prepare('SELECT MAX(end_page) AS maxEnd FROM reading_logs WHERE book_id = ?')
    .get(id);
  if (maxEnd !== null && b.total_pages < maxEnd) {
    throw new ValidationError({
      total_pages: `Total halaman tidak boleh lebih kecil dari halaman akhir pada reading log (${maxEnd})`,
    });
  }
  db.prepare(
    `UPDATE books SET title = ?, author = ?, category = ?, total_pages = ?, current_page = ?,
            status = ?, started_at = ?, finished_at = ?, notes = ?, updated_at = ${NOW}
      WHERE id = ? AND user_id = ?`,
  ).run(b.title, b.author, b.category, b.total_pages, b.current_page, b.status, b.started_at, b.finished_at, b.notes, id, userId);
  return getBook(db, userId, id);
}

/** Menghapus buku. Reading log terkait ikut terhapus (ON DELETE CASCADE). */
export function deleteBook(db, userId, id) {
  findBookRow(db, userId, id);
  inTransaction(db, () => {
    db.prepare('DELETE FROM books WHERE id = ? AND user_id = ?').run(id, userId);
  });
}

export function ensureBookExists(db, userId, id) {
  return findBookRow(db, userId, id);
}

/** Buku yang sedang dibaca, terbaru diperbarui dulu (untuk "Lanjutkan Membaca"). */
export function listReadingBooks(db, userId, limit = 5) {
  return db
    .prepare("SELECT * FROM books WHERE user_id = ? AND status = 'sedang_dibaca' ORDER BY updated_at DESC, id DESC LIMIT ?")
    .all(userId, limit)
    .map(decorate);
}

/**
 * Menetapkan progres buku berdasarkan reading log lalu menyelaraskan status & tanggal.
 * Dipanggil dari logService (di dalam transaksi; kepemilikan buku sudah diperiksa pemanggil).
 *  - current_page = newCurrent (dibatasi 0..total_pages)
 *  - current_page = total_pages  -> status selesai, finished_at = finished_at lama atau logDate
 *  - 0 < current_page < total    -> status sedang_dibaca, finished_at dikosongkan
 *  - current_page = 0            -> tetap belum_dibaca bila sebelumnya belum_dibaca, selain itu sedang_dibaca
 *  - started_at = tanggal paling awal antara started_at lama dan logDate (bila ada progres)
 */
export function applyLogProgress(db, bookId, newCurrent, logDate) {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
  const total = book.total_pages;
  const current = Math.min(Math.max(newCurrent, 0), total);

  let started = book.started_at;
  if (current > 0 && (!started || logDate < started)) started = logDate;

  let status;
  let finished = book.finished_at;
  if (current >= total) {
    status = 'selesai';
    if (!finished) finished = logDate;
  } else {
    finished = null;
    if (current > 0) status = 'sedang_dibaca';
    else status = book.status === 'belum_dibaca' ? 'belum_dibaca' : 'sedang_dibaca';
  }

  db.prepare(
    `UPDATE books SET current_page = ?, status = ?, started_at = ?, finished_at = ?, updated_at = ${NOW}
      WHERE id = ?`,
  ).run(current, status, started, finished, bookId);
}
