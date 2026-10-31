import { NotFoundError, ValidationError } from '../utils/errors.js';
import { validateLogInput } from '../validators/log.js';
import { applyLogProgress, ensureBookExists } from './bookService.js';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const SELECT_LOG = `SELECT l.*, b.title AS book_title
                      FROM reading_logs l JOIN books b ON b.id = l.book_id`;

async function findLog(db, userId, id) {
  const row = await db.prepare(`${SELECT_LOG} WHERE l.id = ? AND b.user_id = ?`).get(id, userId);
  if (!row) throw new NotFoundError('Reading log');
  return { ...row };
}

export async function getLog(db, userId, id) {
  return findLog(db, userId, id);
}

export async function listLogsForBook(db, userId, bookId) {
  await ensureBookExists(db, userId, bookId);
  const rows = await db
    .prepare(`${SELECT_LOG} WHERE l.book_id = ? ORDER BY l.log_date DESC, l.id DESC`)
    .all(bookId);
  return rows.map((r) => ({ ...r }));
}

export async function listLogs(db, userId, { bookId, from, to, limit = 50, offset = 0 } = {}) {
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
  const [{ total }, rows] = await Promise.all([
    db
      .prepare(`SELECT COUNT(*) AS total FROM reading_logs l JOIN books b ON b.id = l.book_id ${clause}`)
      .get(...params),
    db
      .prepare(`${SELECT_LOG} ${clause} ORDER BY l.log_date DESC, l.id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset),
  ]);
  return { rows: rows.map((r) => ({ ...r })), total };
}

async function assertWithinBook(db, userId, bookId, endPage) {
  const book = await db.prepare('SELECT id, total_pages FROM books WHERE id = ? AND user_id = ?').get(bookId, userId);
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
export async function createLog(db, userId, raw, { today }) {
  const input = validateLogInput(raw, { today });
  return db.transaction(async (tx) => {
    const book = await assertWithinBook(tx, userId, input.book_id, input.end_page);
    const { current_page: current } = await tx.prepare('SELECT current_page FROM books WHERE id = ?').get(book.id);
    const result = await tx
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
    await applyLogProgress(tx, input.book_id, Math.max(current, input.end_page), input.log_date);
    return findLog(tx, userId, Number(result.lastInsertRowid));
  });
}

export async function updateLog(db, userId, id, raw, { today }) {
  const existing = await findLog(db, userId, id);
  const input = validateLogInput(raw, { today, requireBookId: false });
  if (input.book_id !== undefined && input.book_id !== existing.book_id) {
    throw new ValidationError({ book_id: 'Reading log tidak dapat dipindahkan ke buku lain' });
  }
  return db.transaction(async (tx) => {
    await assertWithinBook(tx, userId, existing.book_id, input.end_page);
    await tx.prepare(
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
    const { maxEnd } = await tx
      .prepare('SELECT MAX(end_page) AS maxEnd FROM reading_logs WHERE book_id = ?')
      .get(existing.book_id);
    await applyLogProgress(tx, existing.book_id, maxEnd, input.log_date);
    return findLog(tx, userId, id);
  });
}

export async function deleteLog(db, userId, id) {
  const existing = await findLog(db, userId, id);
  await db.transaction(async (tx) => {
    await tx.prepare('DELETE FROM reading_logs WHERE id = ?').run(id);
    const { maxEnd } = await tx
      .prepare('SELECT MAX(end_page) AS maxEnd FROM reading_logs WHERE book_id = ?')
      .get(existing.book_id);
    if (maxEnd !== null) await applyLogProgress(tx, existing.book_id, maxEnd, existing.log_date);
  });
}
