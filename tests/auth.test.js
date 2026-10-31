import assert from 'node:assert/strict';
import { test } from './runner.js';
import {
  createSession, deleteAllUserData, deleteSession, getSessionUser, hashPassword, loginUser,
  registerUser, updateProfile, verifyPassword, SESSION_TTL_DAYS,
} from '../src/services/authService.js';
import { createBook, listBooks } from '../src/services/bookService.js';
import { createLog, listLogs } from '../src/services/logService.js';
import { getCategoryDistribution, getDashboardSummary, getReadingHabits } from '../src/services/statsService.js';
import { FailureLimiter } from '../src/utils/rateLimiter.js';
import { parseCookies } from '../src/middleware/auth.js';
import { openDatabase } from '../src/db/connection.js';
import { catchErrorAsync, ctx, validBook, validLog } from './helpers.js';

const newDb = () => openDatabase(':memory:');
const reg = (db, over = {}) =>
  registerUser(db, { name: 'Budi', email: 'Budi@Example.com', password: 'rahasia123', ...over });

test('hash password: acak per pengguna, benar/salah terverifikasi', async () => {
  const a = await hashPassword('kata-sandi-1');
  const b = await hashPassword('kata-sandi-1');
  assert.notEqual(a, b, 'salt berbeda');
  assert.match(a, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.equal(await verifyPassword('kata-sandi-1', a), true);
  assert.equal(await verifyPassword('salah', a), false);
  assert.equal(await verifyPassword('x', 'format-rusak'), false);
});

test('registerUser: sukses, email dinormalisasi, hash tidak bocor', async () => {
  const db = await newDb();
  const u = await reg(db);
  assert.equal(u.email, 'budi@example.com');
  assert.equal(u.name, 'Budi');
  assert.equal(u.daily_goal_pages, 30);
  assert.equal('password_hash' in u, false);
  const stored = (await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(u.id)).password_hash;
  assert.notEqual(stored, 'rahasia123');
  assert.ok(stored.startsWith('scrypt$'));
});

test('registerUser: validasi dan email ganda (tidak peka huruf besar/kecil)', async () => {
  const db = await newDb();
  const bad = await catchErrorAsync(() => registerUser(db, { name: '', email: 'bukan-email', password: 'pendek' }));
  assert.equal(bad.status, 422);
  assert.ok(bad.details.name && bad.details.email && bad.details.password);
  assert.ok((await catchErrorAsync(() => reg(db, { password: 'x'.repeat(129) }))).details.password);
  assert.equal((await catchErrorAsync(() => registerUser(db, null))).status, 422);

  await reg(db);
  const dup = await catchErrorAsync(() => reg(db, { email: 'BUDI@example.COM' }));
  assert.equal(dup.status, 409);
  assert.ok(dup.details.email);
});

test('loginUser: sukses, kata sandi salah, email tidak ada, input kosong', async () => {
  const db = await newDb();
  await reg(db);
  const ok = await loginUser(db, { email: ' BUDI@example.com ', password: 'rahasia123' });
  assert.equal(ok.name, 'Budi');
  const wrong = await catchErrorAsync(() => loginUser(db, { email: 'budi@example.com', password: 'salah-salah' }));
  const unknown = await catchErrorAsync(() => loginUser(db, { email: 'tidak@ada.com', password: 'rahasia123' }));
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.message, unknown.message, 'pesan sama agar email tidak dapat ditebak');
  assert.equal((await catchErrorAsync(() => loginUser(db, { email: '', password: '' }))).status, 422);
  assert.equal((await catchErrorAsync(() => loginUser(db, { email: 123, password: {} }))).status, 422);
});

test('sesi: buat, baca, kedaluwarsa, logout; token mentah tidak disimpan', async () => {
  const db = await newDb();
  const user = await reg(db);
  const now = new Date('2026-10-21T00:00:00Z');
  const { token, expiresAt } = await createSession(db, user.id, now);
  assert.equal(expiresAt.toISOString(), new Date(now.getTime() + SESSION_TTL_DAYS * 86400000).toISOString());
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE id = ?').get(token)).n, 0, 'hanya hash yang disimpan');
  assert.equal((await getSessionUser(db, token, now)).id, user.id);
  assert.equal(await getSessionUser(db, 'token-ngawur', now), null);
  assert.equal(await getSessionUser(db, undefined, now), null);

  const later = new Date(now.getTime() + (SESSION_TTL_DAYS + 1) * 86400000);
  assert.equal(await getSessionUser(db, token, later), null, 'kedaluwarsa');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).n, 0, 'sesi kedaluwarsa dibersihkan');

  const s2 = await createSession(db, user.id, now);
  await deleteSession(db, s2.token);
  assert.equal(await getSessionUser(db, s2.token, now), null);
});

test('updateProfile: nama dan target harian, dengan validasi', async () => {
  const db = await newDb();
  const u = await reg(db);
  assert.equal((await updateProfile(db, u.id, { daily_goal_pages: '45' })).daily_goal_pages, 45);
  assert.equal((await updateProfile(db, u.id, { name: 'Budi Baru' })).name, 'Budi Baru');
  assert.equal((await updateProfile(db, u.id, { name: 'Budi Baru' })).daily_goal_pages, 45, 'field lain tidak berubah');
  for (const bad of [0, -3, 10001, 2.5, 'abc']) {
    assert.ok((await catchErrorAsync(() => updateProfile(db, u.id, { daily_goal_pages: bad }))).details.daily_goal_pages, String(bad));
  }
  assert.ok((await catchErrorAsync(() => updateProfile(db, u.id, {}))).details._body);
});

test('isolasi data: pengguna tidak dapat melihat/mengubah data pengguna lain', async () => {
  const db = await newDb();
  const a = await reg(db, { email: 'a@example.com' });
  const b = await reg(db, { email: 'b@example.com' });
  const bookA = await createBook(db, a.id, validBook({ title: 'Milik A', category: 'Fiksi' }), ctx);
  await createLog(db, a.id, validLog(bookA.id), ctx);

  assert.equal((await listBooks(db, b.id)).length, 0);
  assert.equal((await listLogs(db, b.id)).total, 0);
  assert.equal((await getDashboardSummary(db, b.id, { today: ctx.today })).total_books, 0);
  assert.equal((await getCategoryDistribution(db, b.id)).total_books, 0);
  assert.equal((await getReadingHabits(db, b.id, { days: 30, today: ctx.today })).sessions, 0);
  assert.equal((await getDashboardSummary(db, a.id, { today: ctx.today })).total_books, 1);

  const { getBook, updateBook, deleteBook } = await import('../src/services/bookService.js');
  const { getLog, updateLog, deleteLog, listLogsForBook } = await import('../src/services/logService.js');
  assert.equal((await catchErrorAsync(() => getBook(db, b.id, bookA.id))).status, 404);
  assert.equal((await catchErrorAsync(() => updateBook(db, b.id, bookA.id, validBook(), ctx))).status, 404);
  assert.equal((await catchErrorAsync(() => deleteBook(db, b.id, bookA.id))).status, 404);
  assert.equal((await catchErrorAsync(() => listLogsForBook(db, b.id, bookA.id))).status, 404);
  const logId = (await listLogs(db, a.id)).rows[0].id;
  assert.equal((await catchErrorAsync(() => getLog(db, b.id, logId))).status, 404);
  assert.equal((await catchErrorAsync(() => updateLog(db, b.id, logId, validLog(bookA.id), ctx))).status, 404);
  assert.equal((await catchErrorAsync(() => deleteLog(db, b.id, logId))).status, 404);
  const err = await catchErrorAsync(() => createLog(db, b.id, validLog(bookA.id), ctx));
  assert.equal(err.status, 422, 'tidak dapat mencatat log pada buku orang lain');
  assert.ok(err.details.book_id);

  assert.equal((await listBooks(db, a.id)).length, 1, 'data A tetap utuh');
  assert.equal((await listLogs(db, a.id)).total, 1);
});

test('deleteAllUserData menghapus data pengguna itu saja; hapus pengguna menghapus sesi dan bukunya', async () => {
  const db = await newDb();
  const a = await reg(db, { email: 'a@example.com' });
  const b = await reg(db, { email: 'b@example.com' });
  const bookA = await createBook(db, a.id, validBook(), ctx);
  await createLog(db, a.id, validLog(bookA.id), ctx);
  await createBook(db, b.id, validBook({ title: 'B' }), ctx);
  await createSession(db, a.id);

  await deleteAllUserData(db, a.id);
  assert.equal((await listBooks(db, a.id)).length, 0);
  assert.equal((await listLogs(db, a.id)).total, 0);
  assert.equal((await listBooks(db, b.id)).length, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM users').get()).n, 2, 'akun tetap ada');

  await createBook(db, a.id, validBook({ title: 'Lagi' }), ctx);
  (await db.prepare('DELETE FROM users WHERE id = ?').run(a.id));
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).n, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM books WHERE user_id = ?').get(a.id)).n, 0);
});

test('FailureLimiter: memblokir setelah batas gagal dan pulih setelah jendela waktu', async () => {
  let t = 0;
  const lim = new FailureLimiter({ windowMs: 1000, max: 3, now: () => t });
  assert.equal(lim.isBlocked('k'), false);
  lim.fail('k'); lim.fail('k');
  assert.equal(lim.isBlocked('k'), false);
  lim.fail('k');
  assert.equal(lim.isBlocked('k'), true);
  assert.equal(lim.isBlocked('lain'), false);
  t = 1500;
  assert.equal(lim.isBlocked('k'), false, 'jendela berakhir');
  lim.fail('k'); lim.reset('k');
  assert.equal(lim.isBlocked('k'), false);
});

test('parseCookies', async () => {
  assert.deepEqual(parseCookies('a=1; tanaread_session=abc_-123; x=y%20z'), { a: '1', tanaread_session: 'abc_-123', x: 'y z' });
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies('rusak'), {});
});
