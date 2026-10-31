import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from './runner.js';
import { openDatabase } from '../src/db/connection.js';
import { createClient } from '@libsql/client';
import { MIGRATIONS, SCHEMA_VERSION, currentVersion } from '../src/db/schema.js';
import { createSession, getSessionUser, registerUser } from '../src/services/authService.js';
import { createBook, getBook } from '../src/services/bookService.js';
import { createLog } from '../src/services/logService.js';
import { U, addUser, ctx, makeDb, removeTempDir, validBook, validLog } from './helpers.js';

test('foreign key aktif dan skema terpasang', async () => {
  const db = await makeDb();
  assert.equal((await db.prepare('PRAGMA foreign_keys').get()).foreign_keys, 1);
  assert.equal(await currentVersion(db), SCHEMA_VERSION);
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).map((r) => r.name);
  assert.ok(tables.includes('books'));
  assert.ok(tables.includes('reading_logs'));
});

test('constraint CHECK menolak data tidak konsisten langsung di database', async () => {
  const db = await makeDb();
  const ins = (...v) =>
    db.prepare('INSERT INTO books (title, author, total_pages, current_page, status) VALUES (?,?,?,?,?)').run(...v);
  await assert.rejects(async () => ins('a', 'b', 100, 101, 'sedang_dibaca'), /CHECK/);
  await assert.rejects(async () => ins('a', 'b', 100, 100, 'sedang_dibaca'), /CHECK/);
  await assert.rejects(async () => ins('a', 'b', 100, 50, 'selesai'), /CHECK/);
  await assert.rejects(async () => ins('a', 'b', 100, 10, 'belum_dibaca'), /CHECK/);
  await assert.rejects(async () => ins('a', 'b', 0, 0, 'belum_dibaca'), /CHECK/);
  await assert.rejects(async () => ins('  ', 'b', 10, 0, 'belum_dibaca'), /CHECK/);
});

test('foreign key menolak log untuk buku yang tidak ada', async () => {
  const db = await makeDb();
  await assert.rejects(
    () =>
      db
        .prepare('INSERT INTO reading_logs (book_id, log_date, start_page, end_page, pages_read, duration_minutes) VALUES (999,?,?,?,?,?)')
        .run('2026-10-20', 0, 10, 10, 5),
    /FOREIGN KEY/,
  );
});

test('migrasi aman dijalankan berulang dan data persisten setelah database dibuka ulang', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tanaread-'));
  const file = path.join(dir, 'sub', 'test.db');
  try {
    let db = await openDatabase(file);
    await addUser(db);
    const book = await createBook(db, U, validBook({ title: 'Persisten' }), ctx);
    await createLog(db, U, validLog(book.id), ctx);
    db.close();

    db = await openDatabase(file); // simulasi server restart: migrasi dijalankan lagi
    assert.equal(await currentVersion(db), SCHEMA_VERSION);
    const again = await getBook(db, U, book.id);
    assert.equal(again.title, 'Persisten');
    assert.equal(again.current_page, 50);
    assert.equal(again.log_summary.sessions, 1);
    db.close();
  } finally {
    removeTempDir(dir);
  }
});

test('dua instance memakai database yang sama: akun dan sesi dari instance A terbaca di instance B', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tanaread-'));
  const file = path.join(dir, 'shared.db');
  try {
    const a = await openDatabase(file);
    const b = await openDatabase(file); // seperti dua instance serverless yang menunjuk ke satu database
    const user = await registerUser(a, { name: 'Sari', email: 'sari@example.com', password: 'rahasia123' });
    const { token } = await createSession(a, user.id);
    assert.equal((await getSessionUser(b, token)).email, 'sari@example.com');
    a.close();
    b.close();
  } finally {
    removeTempDir(dir);
  }
});

test('database lama yang memakai PRAGMA user_version diakui tanpa mengulang migrasi', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tanaread-'));
  const file = path.join(dir, 'legacy.db');
  try {
    const legacy = createClient({ url: `file:${file}` });
    for (const statements of MIGRATIONS) for (const sql of statements) await legacy.execute(sql);
    await legacy.execute(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    legacy.close();

    const db = await openDatabase(file); // ALTER TABLE v2 tidak boleh dijalankan lagi
    assert.equal(await currentVersion(db), SCHEMA_VERSION);
    db.close();
  } finally {
    removeTempDir(dir);
  }
});
