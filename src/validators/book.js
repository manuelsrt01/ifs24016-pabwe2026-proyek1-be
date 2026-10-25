import { ValidationError } from '../utils/errors.js';
import { isValidDate } from '../utils/dates.js';
import { isBlank, parseInteger, readText, requireBodyObject } from './common.js';

export const STATUSES = ['belum_dibaca', 'sedang_dibaca', 'selesai'];
export const MAX_PAGES = 100000;

/**
 * Memvalidasi & menormalkan input buku (dipakai untuk POST dan PUT penuh).
 *
 * Aturan konsistensi status <-> progres:
 *  - belum_dibaca  : current_page harus 0
 *  - sedang_dibaca : 0 <= current_page < total_pages
 *  - selesai       : current_page = total_pages (diisi otomatis bila tidak dikirim)
 *  - Bila status tidak dikirim, status diturunkan dari current_page.
 *  - finished_at hanya boleh ada bila status selesai (default: hari ini).
 */
export function validateBookInput(raw, { today }) {
  if (!requireBodyObject(raw)) {
    throw new ValidationError({ _body: 'Body harus berupa objek JSON' });
  }
  const e = {};

  const title = readText(raw, 'title', 'Judul', { required: true, max: 200 }, e);
  const author = readText(raw, 'author', 'Penulis', { required: true, max: 150 }, e);
  const category = readText(raw, 'category', 'Kategori', { max: 60 }, e);
  const notes = readText(raw, 'notes', 'Catatan', { max: 1000 }, e);

  let total = Number.NaN;
  if (isBlank(raw.total_pages)) e.total_pages = 'Total halaman wajib diisi';
  else {
    total = parseInteger(raw.total_pages);
    if (!Number.isInteger(total) || total <= 0) {
      e.total_pages = 'Total halaman harus bilangan bulat positif';
    } else if (total > MAX_PAGES) {
      e.total_pages = `Total halaman maksimal ${MAX_PAGES}`;
    }
  }
  const totalOk = e.total_pages === undefined;

  let current;
  if (!isBlank(raw.current_page)) {
    current = parseInteger(raw.current_page);
    if (!Number.isInteger(current) || current < 0) {
      e.current_page = 'Halaman terakhir harus bilangan bulat ≥ 0';
    } else if (totalOk && current > total) {
      e.current_page = 'Halaman terakhir tidak boleh melebihi total halaman';
    }
  }
  const currentOk = e.current_page === undefined;

  let status;
  if (isBlank(raw.status)) {
    if (totalOk && currentOk) {
      if (current === undefined || current === 0) status = 'belum_dibaca';
      else status = current === total ? 'selesai' : 'sedang_dibaca';
    }
  } else if (!STATUSES.includes(raw.status)) {
    e.status = `Status harus salah satu dari: ${STATUSES.join(', ')}`;
  } else {
    status = raw.status;
  }

  if (status && totalOk && currentOk) {
    if (status === 'selesai') {
      if (current === undefined) current = total;
      else if (current !== total) {
        e.current_page = 'Status selesai mengharuskan halaman terakhir sama dengan total halaman';
      }
    } else if (status === 'belum_dibaca') {
      if (current === undefined) current = 0;
      else if (current !== 0) e.current_page = 'Status belum dibaca mengharuskan halaman terakhir 0';
    } else {
      if (current === undefined) current = 0;
      if (current >= total) {
        e.current_page = 'Status sedang dibaca mengharuskan halaman terakhir kurang dari total halaman';
      }
    }
  }

  let startedAt = null;
  if (!isBlank(raw.started_at)) {
    if (isValidDate(raw.started_at)) startedAt = raw.started_at;
    else e.started_at = 'Tanggal mulai harus berformat YYYY-MM-DD yang valid';
  }

  let finishedAt = null;
  if (!isBlank(raw.finished_at)) {
    if (!isValidDate(raw.finished_at)) e.finished_at = 'Tanggal selesai harus berformat YYYY-MM-DD yang valid';
    else if (status && status !== 'selesai') {
      e.finished_at = 'Tanggal selesai hanya boleh diisi bila status selesai';
    } else finishedAt = raw.finished_at;
  } else if (status === 'selesai') {
    finishedAt = today;
  }
  if (startedAt && finishedAt && !e.started_at && !e.finished_at && finishedAt < startedAt) {
    e.finished_at = 'Tanggal selesai tidak boleh lebih awal dari tanggal mulai';
  }

  if (Object.keys(e).length > 0) throw new ValidationError(e);

  return {
    title,
    author,
    category,
    total_pages: total,
    current_page: current,
    status,
    started_at: startedAt,
    finished_at: finishedAt,
    notes,
  };
}
