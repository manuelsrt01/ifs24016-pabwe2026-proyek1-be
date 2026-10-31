/**
 * Pengujian HTTP end-to-end terhadap aplikasi Express (memakai fetch bawaan, tanpa dependency tambahan).
 * Setiap "klien" menyimpan cookie sesinya sendiri (cookie jar sederhana).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from './runner.js';
import { createApp } from '../src/app.js';
import { getConfig } from '../src/config/env.js';
import { openDatabase } from '../src/db/connection.js';
import { FailureLimiter } from '../src/utils/rateLimiter.js';
import { TODAY, removeTempDir } from './helpers.js';

const config = { ...getConfig({}), clientDist: '/tidak/ada', corsOrigins: ['http://localhost:5173'], cookieSecure: false };

async function startServer(db, limiter) {
  const app = createApp({ db, config, today: () => TODAY, limiter });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  /** Membuat klien baru dengan cookie jar sendiri. */
  const client = () => {
    let cookie = '';
    const call = async (method, url, body, headers = {}) => {
      const h = { ...headers };
      if (cookie) h.Cookie = cookie;
      if (body !== undefined) h['Content-Type'] = 'application/json';
      const res = await fetch(base + url, {
        method,
        headers: h,
        body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) {
        const pair = setCookie.split(';')[0];
        cookie = pair.endsWith('=') ? '' : pair;
      }
      const text = await res.text();
      return { status: res.status, headers: res.headers, setCookie, json: text ? JSON.parse(text) : null };
    };
    return { call, hasCookie: () => cookie !== '' };
  };
  const close = () => new Promise((resolve) => server.close(resolve));
  return { client, close };
}

const book = (over = {}) => ({ title: 'Buku API', author: 'Penulis', category: 'Fiksi', total_pages: 100, ...over });
const log = (bookId, over = {}) => ({
  book_id: bookId, log_date: '2026-10-20', start_page: 0, end_page: 40, duration_minutes: 25, ...over,
});
const creds = (email = 'budi@example.com') => ({ name: 'Budi', email, password: 'rahasia123' });

describe('Autentikasi', () => {
  let db;
  let srv;
  before(async () => {
    db = await openDatabase(':memory:');
    srv = await startServer(db, new FailureLimiter({ max: 3 }));
  });
  after(async () => {
    await srv.close();
    db.close();
  });

  test('health tetap publik, endpoint data butuh login (401)', async () => {
    const c = srv.client();
    assert.equal((await c.call('GET', '/api/health')).status, 200);
    for (const url of ['/api/books', '/api/reading-logs', '/api/dashboard/summary', '/api/statistics/reading-habits', '/api/statistics/categories', '/api/auth/me']) {
      const r = await c.call('GET', url);
      assert.equal(r.status, 401, url);
      assert.equal(r.json.error.code, 'UNAUTHORIZED');
    }
    assert.equal((await c.call('POST', '/api/books', book())).status, 401);
  });

  test('register: cookie HttpOnly diset, /me berhasil, hash tidak bocor', async () => {
    const c = srv.client();
    const r = await c.call('POST', '/api/auth/register', creds());
    assert.equal(r.status, 201);
    assert.equal(r.json.data.email, 'budi@example.com');
    assert.equal('password_hash' in r.json.data, false);
    assert.match(r.setCookie, /tanaread_session=/);
    assert.match(r.setCookie, /HttpOnly/i);
    assert.match(r.setCookie, /SameSite=Lax/i);
    const me = await c.call('GET', '/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.json.data.name, 'Budi');
  });

  test('register: validasi (422) dan email ganda (409)', async () => {
    const c = srv.client();
    const bad = await c.call('POST', '/api/auth/register', { name: '', email: 'x', password: '123' });
    assert.equal(bad.status, 422);
    assert.ok(bad.json.error.details.email && bad.json.error.details.password);
    const dup = await c.call('POST', '/api/auth/register', creds('BUDI@example.com'));
    assert.equal(dup.status, 409);
  });

  test('login benar/salah, logout menghapus sesi', async () => {
    const c = srv.client();
    const wrong = await c.call('POST', '/api/auth/login', { email: 'budi@example.com', password: 'salah-banget' });
    assert.equal(wrong.status, 401);
    assert.equal(c.hasCookie(), false);

    const ok = await c.call('POST', '/api/auth/login', { email: 'budi@example.com', password: 'rahasia123' });
    assert.equal(ok.status, 200);
    assert.equal((await c.call('GET', '/api/books')).status, 200);

    assert.equal((await c.call('POST', '/api/auth/logout')).status, 204);
    assert.equal((await c.call('GET', '/api/books')).status, 401);
  });

  test('cookie palsu ditolak', async () => {
    const c = srv.client();
    const r = await c.call('GET', '/api/books', undefined, { Cookie: 'tanaread_session=palsu' });
    assert.equal(r.status, 401);
  });

  test('login dibatasi setelah terlalu banyak kegagalan (429)', async () => {
    const c = srv.client();
    const body = { email: 'korban@example.com', password: 'tebakan-salah' };
    for (let i = 0; i < 3; i += 1) assert.equal((await c.call('POST', '/api/auth/login', body)).status, 401);
    assert.equal((await c.call('POST', '/api/auth/login', body)).status, 429);
  });
});

describe('API data (terautentikasi)', () => {
  let db;
  let srv;
  let c;
  before(async () => {
    db = await openDatabase(':memory:');
    srv = await startServer(db, new FailureLimiter());
    c = srv.client();
    await c.call('POST', '/api/auth/register', creds());
  });
  after(async () => {
    await srv.close();
    db.close();
  });

  test('endpoint tidak dikenal -> 404 JSON', async () => {
    const r = await c.call('GET', '/api/tidak-ada');
    assert.equal(r.status, 404);
    assert.equal(r.json.error.code, 'NOT_FOUND');
  });

  test('CRUD buku', async () => {
    const created = await c.call('POST', '/api/books', book());
    assert.equal(created.status, 201);
    assert.match(created.headers.get('location'), /^\/api\/books\/\d+$/);
    const id = created.json.data.id;
    assert.equal(created.json.data.status, 'belum_dibaca');
    assert.equal('user_id' in created.json.data, false);

    assert.equal((await c.call('GET', `/api/books/${id}`)).json.data.title, 'Buku API');

    const upd = await c.call('PUT', `/api/books/${id}`, book({ title: 'Diubah', current_page: 10, status: 'sedang_dibaca' }));
    assert.equal(upd.status, 200);
    assert.equal(upd.json.data.progress_percent, 10);

    const list = await c.call('GET', '/api/books?q=ubah&status=sedang_dibaca');
    assert.equal(list.json.meta.total, 1);

    assert.equal((await c.call('DELETE', `/api/books/${id}`)).status, 204);
    assert.equal((await c.call('GET', `/api/books/${id}`)).status, 404);
  });

  test('validasi dan error buku', async () => {
    const bad = await c.call('POST', '/api/books', { title: '', author: '', total_pages: -1 });
    assert.equal(bad.status, 422);
    assert.ok(bad.json.error.details.title);
    assert.equal((await c.call('GET', '/api/books/abc')).status, 400);
    assert.equal((await c.call('GET', '/api/books/99999')).status, 404);
    assert.equal((await c.call('PUT', '/api/books/99999', book())).status, 404);
    assert.equal((await c.call('DELETE', '/api/books/99999')).status, 404);
    assert.equal((await c.call('GET', '/api/books?status=ngawur')).status, 422);
    const badJson = await c.call('POST', '/api/books', '{bukan json');
    assert.equal(badJson.status, 400);
    assert.equal(badJson.json.error.code, 'INVALID_JSON');
  });

  test('reading log: CRUD, progres buku, dan cascade', async () => {
    const b = (await c.call('POST', '/api/books', book({ title: 'Untuk Log' }))).json.data;
    const l1 = await c.call('POST', '/api/reading-logs', log(b.id));
    assert.equal(l1.status, 201);
    assert.equal(l1.json.data.pages_read, 40);
    let detail = (await c.call('GET', `/api/books/${b.id}`)).json.data;
    assert.equal(detail.current_page, 40);
    assert.equal(detail.status, 'sedang_dibaca');

    const upd = await c.call('PUT', `/api/reading-logs/${l1.json.data.id}`, log(b.id, { end_page: 60 }));
    assert.equal(upd.json.data.pages_read, 60);
    detail = (await c.call('GET', `/api/books/${b.id}`)).json.data;
    assert.equal(detail.current_page, 60);

    assert.equal((await c.call('GET', `/api/books/${b.id}/logs`)).json.meta.total, 1);
    assert.equal((await c.call('GET', `/api/reading-logs?book_id=${b.id}&limit=10`)).json.meta.total, 1);
    assert.equal((await c.call('DELETE', `/api/reading-logs/${l1.json.data.id}`)).status, 204);
    assert.equal((await c.call('GET', `/api/reading-logs/${l1.json.data.id}`)).status, 404);

    const l2 = await c.call('POST', '/api/reading-logs', log(b.id, { start_page: 60, end_page: 90 }));
    await c.call('DELETE', `/api/books/${b.id}`);
    assert.equal((await c.call('GET', `/api/reading-logs/${l2.json.data.id}`)).status, 404);
  });

  test('validasi reading log', async () => {
    const b = (await c.call('POST', '/api/books', book({ title: 'Validasi Log' }))).json.data;
    const post = (over) => c.call('POST', '/api/reading-logs', log(b.id, over));
    assert.equal((await post({ start_page: 50, end_page: 10 })).status, 422);
    assert.equal((await post({ end_page: 101 })).status, 422);
    assert.equal((await post({ duration_minutes: 0 })).status, 422);
    assert.equal((await post({ log_date: '2026-10-22' })).status, 422);
    assert.equal((await c.call('POST', '/api/reading-logs', log(99999))).status, 422);
    assert.equal((await c.call('GET', '/api/reading-logs?limit=0')).status, 422);
    assert.equal((await c.call('GET', '/api/books/99999/logs')).status, 404);
  });

  test('dashboard, statistik, kategori, dan pengaturan', async () => {
    const summary = await c.call('GET', '/api/dashboard/summary');
    assert.equal(summary.status, 200);
    assert.equal(summary.json.data.last_7_days.length, 7);
    assert.equal(summary.json.data.daily_goal_pages, 30);
    assert.ok(Array.isArray(summary.json.data.reading_books));

    assert.equal((await c.call('GET', '/api/statistics/reading-activity?from=2026-10-15&to=2026-10-21')).json.data.days.length, 7);
    assert.equal((await c.call('GET', '/api/statistics/reading-activity?from=2026-10-21&to=2026-10-01')).status, 422);
    assert.equal((await c.call('GET', '/api/statistics/reading-habits?days=7')).json.data.period.days, 7);
    assert.equal((await c.call('GET', '/api/statistics/reading-habits?days=all')).json.data.period.all_time, true);
    assert.equal((await c.call('GET', '/api/statistics/reading-habits?days=0')).status, 422);
    assert.equal((await c.call('GET', '/api/statistics/categories')).status, 200);

    const goal = await c.call('PATCH', '/api/auth/me', { daily_goal_pages: 45 });
    assert.equal(goal.json.data.daily_goal_pages, 45);
    assert.equal((await c.call('GET', '/api/dashboard/summary')).json.data.daily_goal_pages, 45);
    assert.equal((await c.call('PATCH', '/api/auth/me', { daily_goal_pages: 0 })).status, 422);
  });

  test('reset data milik sendiri tidak menghapus akun', async () => {
    await c.call('POST', '/api/books', book({ title: 'Akan Dihapus' }));
    assert.equal((await c.call('DELETE', '/api/auth/me/data')).status, 204);
    assert.equal((await c.call('GET', '/api/books')).json.meta.total, 0);
    assert.equal((await c.call('GET', '/api/auth/me')).status, 200);
  });
});

describe('Isolasi antar pengguna via HTTP', () => {
  test('pengguna B tidak dapat mengakses buku dan log milik A', async () => {
    const db = await openDatabase(':memory:');
    const srv = await startServer(db, new FailureLimiter());
    try {
      const a = srv.client();
      const b = srv.client();
      await a.call('POST', '/api/auth/register', creds('a@example.com'));
      await b.call('POST', '/api/auth/register', creds('b@example.com'));

      const bookA = (await a.call('POST', '/api/books', book({ title: 'Rahasia A' }))).json.data;
      const logA = (await a.call('POST', '/api/reading-logs', log(bookA.id))).json.data;

      assert.equal((await b.call('GET', '/api/books')).json.meta.total, 0);
      assert.equal((await b.call('GET', `/api/books/${bookA.id}`)).status, 404);
      assert.equal((await b.call('PUT', `/api/books/${bookA.id}`, book())).status, 404);
      assert.equal((await b.call('DELETE', `/api/books/${bookA.id}`)).status, 404);
      assert.equal((await b.call('GET', `/api/reading-logs/${logA.id}`)).status, 404);
      assert.equal((await b.call('DELETE', `/api/reading-logs/${logA.id}`)).status, 404);
      assert.equal((await b.call('POST', '/api/reading-logs', log(bookA.id))).status, 422);
      assert.equal((await b.call('GET', '/api/dashboard/summary')).json.data.total_books, 0);

      assert.equal((await a.call('GET', `/api/books/${bookA.id}`)).status, 200, 'data A tetap utuh');
    } finally {
      await srv.close();
      db.close();
    }
  });
});

describe('Persistensi data setelah server dimulai ulang', () => {
  test('akun, sesi, dan data tetap ada setelah server & database ditutup lalu dibuka lagi', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tanaread-api-'));
    const file = path.join(dir, 'persist.db');
    try {
      let db = await openDatabase(file);
      let srv = await startServer(db, new FailureLimiter());
      const c1 = srv.client();
      await c1.call('POST', '/api/auth/register', creds('p@example.com'));
      const id = (await c1.call('POST', '/api/books', book({ title: 'Bertahan' }))).json.data.id;
      await c1.call('POST', '/api/reading-logs', log(id));
      await srv.close();
      db.close();

      db = await openDatabase(file);
      srv = await startServer(db, new FailureLimiter());
      const c2 = srv.client();
      assert.equal((await c2.call('POST', '/api/auth/login', { email: 'p@example.com', password: 'rahasia123' })).status, 200);
      const got = await c2.call('GET', `/api/books/${id}`);
      assert.equal(got.json.data.title, 'Bertahan');
      assert.equal(got.json.data.log_summary.sessions, 1);
      await srv.close();
      db.close();
    } finally {
      removeTempDir(dir);
    }
  });
});
