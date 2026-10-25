import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from './runner.js';
import { openDatabase } from '../src/db/connection.js';
import { SCHEMA_VERSION } from '../src/db/schema.js';
import { createBook, getBook } from '../src/services/bookService.js';
import { createLog } from '../src/services/logService.js';
import { U, addUser, ctx, makeDb, removeTempDir, validBook, validLog } from './helpers.js';

test('foreign key aktif dan skema terpasang', () => {
  const db = makeDb();
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  assert.ok(tables.includes('books'));
  assert.ok(tables.includes('reading_logs'));
});

test('constraint CHECK menolak data tidak konsisten langsung di database', () => {
  const db = makeDb();
  const ins = (...v) =>
    db.prepare('INSERT INTO books (title, author, total_pages, current_page, status) VALUES (?,?,?,?,?)').run(...v);
  assert.throws(() => ins('a', 'b', 100, 101, 'sedang_dibaca'), /CHECK/);
  assert.throws(() => ins('a', 'b', 100, 100, 'sedang_dibaca'), /CHECK/);
  assert.throws(() => ins('a', 'b', 100, 50, 'selesai'), /CHECK/);
  assert.throws(() => ins('a', 'b', 100, 10, 'belum_dibaca'), /CHECK/);
  assert.throws(() => ins('a', 'b', 0, 0, 'belum_dibaca'), /CHECK/);
  assert.throws(() => ins('  ', 'b', 10, 0, 'belum_dibaca'), /CHECK/);
});

test('foreign key menolak log untuk buku yang tidak ada', () => {
  const db = makeDb();
  assert.throws(
    () =>
      db
        .prepare('INSERT INTO reading_logs (book_id, log_date, start_page, end_page, pages_read, duration_minutes) VALUES (999,?,?,?,?,?)')
        .run('2026-10-20', 0, 10, 10, 5),
    /FOREIGN KEY/,
  );
});

test('migrasi aman dijalankan berulang dan data persisten setelah database dibuka ulang', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tanaread-'));
  const file = path.join(dir, 'sub', 'test.db');
  try {
    let db = openDatabase(file);
    addUser(db);
    const book = createBook(db, U, validBook({ title: 'Persisten' }), ctx);
    createLog(db, U, validLog(book.id), ctx);
    db.close();

    db = openDatabase(file); // simulasi server restart: migrasi dijalankan lagi
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    const again = getBook(db, U, book.id);
    assert.equal(again.title, 'Persisten');
    assert.equal(again.current_page, 50);
    assert.equal(again.log_summary.sessions, 1);
    db.close();
  } finally {
    removeTempDir(dir);
  }
});
