import fs from 'node:fs';
import path from 'node:path';
import { migrate } from './schema.js';

// Bun  -> bun:sqlite (driver resmi bawaan Bun, dipakai proyek ini)
// Node -> node:sqlite (hanya agar kode tetap dapat diuji di lingkungan Node)
const isBun = typeof Bun !== 'undefined';
const Database = isBun
  ? (await import('bun:sqlite')).Database
  : (await import('node:sqlite')).DatabaseSync;

/**
 * Membuka database SQLite, mengaktifkan foreign key secara eksplisit,
 * lalu menjalankan migrasi. Database TIDAK pernah dihapus/di-reset di sini.
 */
export function openDatabase(dbPath) {
  const inMemory = dbPath === ':memory:';
  if (!inMemory) fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = inMemory
    ? new Database(':memory:')
    : isBun
      ? new Database(dbPath, { create: true })
      : new Database(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (!inMemory) db.exec('PRAGMA journal_mode = WAL');
  migrate(db);
  return db;
}

/** Menjalankan fn di dalam transaksi; rollback otomatis bila fn melempar error. */
export function inTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
