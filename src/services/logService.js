import { inTransaction } from '../db/connection.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { validateLogInput } from '../validators/log.js';
import { applyLogProgress, ensureBookExists } from './bookService.js';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const SELECT_LOG = `SELECT l.*, b.title AS book_title
                      FROM reading_logs l JOIN books b ON b.id = l.book_id`;

function findLog(db, userId, id) {
  const row = db.prepare(`${SELECT_LOG} WHERE l.id = ? AND b.user_id = ?`).get(id, userId);
  if (!row) throw new NotFoundError('Reading log');
  return { ...row };
}

export function getLog(db, userId, id) {
  return findLog(db, userId, id);
}

export function listLogsForBook(db, userId, bookId) {
  ensureBookExists(db, userId, bookId);
  return db
    .prepare(`${SELECT_LOG} WHERE l.book_id = ? ORDER BY l.log_date DESC, l.id DESC`)
    .all(bookId)
    .map((r) => ({ ...r }));
}

export function listLogs(db, userId, { bookId, from, to, limit = 50, offset = 0 } = {}) {
  const where = ['b.user_id = ?'];
  const params = [userId];
  if (bookId) {
    where.push('l.book_id = ?');
    params.push(bookId);
  }
  if (from) {
    where.push('l.log_date >= ?');
    params.push(from);
  }
  if (to) {
    where.push('l.log_date <= ?');
    params.push(to);
  }
  const clause = `WHERE ${where.join(' AND ')}`;
  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM reading_logs l JOIN books b ON b.id = l.book_id ${clause}`)
    .get(...params);
  const rows = db
    .prepare(`${SELECT_LOG} ${clause} ORDER BY l.log_date DESC, l.id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset)
    .map((r) => ({ ...r }));
  return { rows, total };
}

function assertWithinBook(db, userId, bookId, endPage) {
  const book = db.prepare('SELECT id, total_pages FROM books WHERE id = ? AND user_id = ?').get(bookId, userId);
  if (!book) throw new ValidationError({ book_id: 'Buku tidak ditemukan' });
  if (endPage > book.total_pages) {
    throw new ValidationError({
      end_page: `Halaman akhir tidak boleh melebihi total halaman buku (${book.total_pages})`,
    });
  }
  return book;
}

/**
 * Aturan progres (anti penghitungan ganda):
 *  - Progres buku adalah POSISI halaman, bukan jumlah. Membuat log: current_page = MAX(current_page, end_page).
 *  - Mengubah/menghapus log: current_page dihitung ulang = MAX(end_page) semua log buku itu
 *    (bila masih ada log). Bila tidak ada log tersisa, progres buku dibiarkan.
 *  - Total halaman pada statistik = SUM(pages_read) log, sehingga membaca ulang halaman
 *    yang sama dihitung sebagai aktivitas baru, tetapi tidak menambah progres buku.
 */
export function createLog(db, userId, raw, { today }) {
  const input = validateLogInput(raw, { today });
  return inTransaction(db, () => {
    const book = assertWithinBook(db, userId, input.book_id, input.end_page);
    const current = db.prepare('SELECT current_page FROM books WHERE id = ?').get(book.id).current_page;
    const result = db
      .prepare(
        `INSERT INTO reading_logs (book_id, log_date, start_page, end_page, pages_read, duration_minutes, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.book_id,
        input.log_date,
        input.start_page,
        input.end_page,
        input.end_page - input.start_page,
        input.duration_minutes,
        input.notes,
      );
    applyLogProgress(db, input.book_id, Math.max(current, input.end_page), input.log_date);
    return findLog(db, userId, Number(result.lastInsertRowid));
  });
}

export function updateLog(db, userId, id, raw, { today }) {
  const existing = findLog(db, userId, id);
  const input = validateLogInput(raw, { today, requireBookId: false });
  if (input.book_id !== undefined && input.book_id !== existing.book_id) {
    throw new ValidationError({ book_id: 'Reading log tidak dapat dipindahkan ke buku lain' });
  }
  return inTransaction(db, () => {
    assertWithinBook(db, userId, existing.book_id, input.end_page);
    db.prepare(
      `UPDATE reading_logs SET log_date = ?, start_page = ?, end_page = ?, pages_read = ?,
              duration_minutes = ?, notes = ?, updated_at = ${NOW}
        WHERE id = ?`,
    ).run(
      input.log_date,
      input.start_page,
      input.end_page,
      input.end_page - input.start_page,
      input.duration_minutes,
      input.notes,
      id,
    );
    const { maxEnd } = db
      .prepare('SELECT MAX(end_page) AS maxEnd FROM reading_logs WHERE book_id = ?')
      .get(existing.book_id);
    applyLogProgress(db, existing.book_id, maxEnd, input.log_date);
    return findLog(db, userId, id);
  });
}

export function deleteLog(db, userId, id) {
  const existing = findLog(db, userId, id);
  inTransaction(db, () => {
    db.prepare('DELETE FROM reading_logs WHERE id = ?').run(id);
    const { maxEnd } = db
      .prepare('SELECT MAX(end_page) AS maxEnd FROM reading_logs WHERE book_id = ?')
      .get(existing.book_id);
    if (maxEnd !== null) applyLogProgress(db, existing.book_id, maxEnd, existing.log_date);
  });
}
