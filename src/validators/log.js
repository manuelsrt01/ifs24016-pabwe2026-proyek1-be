import { ValidationError } from '../utils/errors.js';
import { isValidDate } from '../utils/dates.js';
import { isBlank, parseInteger, readText, requireBodyObject } from './common.js';

export const MAX_DURATION_MINUTES = 1440; // 24 jam per sesi

/**
 * Memvalidasi input reading log (field yang tidak bergantung pada data buku).
 * Pemeriksaan "end_page <= total_pages buku" dilakukan di service karena butuh database.
 *
 * Definisi: start_page = posisi halaman saat mulai membaca (0 = belum mulai),
 *           end_page   = posisi halaman saat berhenti,
 *           pages_read = end_page - start_page.
 */
export function validateLogInput(raw, { today, requireBookId = true }) {
  if (!requireBodyObject(raw)) {
    throw new ValidationError({ _body: 'Body harus berupa objek JSON' });
  }
  const e = {};

  let bookId;
  if (isBlank(raw.book_id)) {
    if (requireBookId) e.book_id = 'Buku wajib dipilih';
  } else {
    bookId = parseInteger(raw.book_id);
    if (!Number.isInteger(bookId) || bookId <= 0) e.book_id = 'ID buku tidak valid';
  }

  let logDate = null;
  if (isBlank(raw.log_date)) e.log_date = 'Tanggal aktivitas wajib diisi';
  else if (!isValidDate(raw.log_date)) e.log_date = 'Tanggal harus berformat YYYY-MM-DD yang valid';
  else if (raw.log_date > today) e.log_date = 'Tanggal aktivitas tidak boleh di masa depan';
  else logDate = raw.log_date;

  const readPage = (key, label) => {
    if (isBlank(raw[key])) {
      e[key] = `${label} wajib diisi`;
      return undefined;
    }
    const n = parseInteger(raw[key]);
    if (!Number.isInteger(n) || n < 0) {
      e[key] = `${label} harus bilangan bulat ≥ 0`;
      return undefined;
    }
    return n;
  };
  const start = readPage('start_page', 'Halaman awal');
  const end = readPage('end_page', 'Halaman akhir');
  if (start !== undefined && end !== undefined && end < start) {
    e.end_page = 'Halaman akhir tidak boleh lebih kecil dari halaman awal';
  }

  let duration;
  if (isBlank(raw.duration_minutes)) e.duration_minutes = 'Durasi wajib diisi';
  else {
    duration = parseInteger(raw.duration_minutes);
    if (!Number.isInteger(duration) || duration <= 0) {
      e.duration_minutes = 'Durasi harus bilangan bulat positif (menit)';
    } else if (duration > MAX_DURATION_MINUTES) {
      e.duration_minutes = `Durasi maksimal ${MAX_DURATION_MINUTES} menit per sesi`;
    }
  }

  const notes = readText(raw, 'notes', 'Catatan', { max: 1000 }, e);

  if (Object.keys(e).length > 0) throw new ValidationError(e);

  return {
    book_id: bookId,
    log_date: logDate,
    start_page: start,
    end_page: end,
    duration_minutes: duration,
    notes,
  };
}
