import fs from 'node:fs';
import { openDatabase } from '../src/db/connection.js';

export const TODAY = '2026-10-21';
export const ctx = { today: TODAY };

/** ID pengguna uji default (dibuat otomatis oleh makeDb / addUser). */
export const U = 1;

export function addUser(db, email = 'uji@example.com') {
  const r = db
    .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
    .run('Pengguna Uji', email, 'scrypt$00$00');
  return Number(r.lastInsertRowid);
}

/**
 * Menghapus folder sementara milik test. Di Windows, berkas SQLite bisa masih terkunci (EBUSY/EPERM)
 * sampai statement yang belum difinalisasi dilepas; itu tidak mempengaruhi hasil test, jadi diabaikan.
 */
export function removeTempDir(dir) {
  globalThis.Bun?.gc(true);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    if (err.code !== 'EBUSY' && err.code !== 'EPERM') throw err;
  }
}

export function makeDb() {
  const db = openDatabase(':memory:');
  addUser(db); // id 1 = U
  return db;
}

export const validBook = (over = {}) => ({
  title: 'Buku Uji',
  author: 'Penulis Uji',
  category: 'Fiksi',
  total_pages: 200,
  ...over,
});

export const validLog = (bookId, over = {}) => ({
  book_id: bookId,
  log_date: '2026-10-20',
  start_page: 0,
  end_page: 50,
  duration_minutes: 30,
  ...over,
});

/** Menjalankan fn dan mengembalikan error yang dilempar (atau gagal bila tidak ada). */
export function catchError(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('Diharapkan melempar error, tetapi tidak ada');
}

export async function catchErrorAsync(fn) {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error('Diharapkan melempar error, tetapi tidak ada');
}
