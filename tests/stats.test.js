import assert from 'node:assert/strict';
import { test } from './runner.js';
import { createBook } from '../src/services/bookService.js';
import { createLog } from '../src/services/logService.js';
import {
  computeStreaks, getCategoryDistribution, getDashboardSummary, getReadingActivity, getReadingHabits,
} from '../src/services/statsService.js';
import { U, ctx, makeDb, validBook, validLog } from './helpers.js';

const TODAY = ctx.today; // 2026-10-21

function seedData() {
  const db = makeDb();
  const a = createBook(db, U, validBook({ title: 'A', total_pages: 100 }), ctx);
  const b = createBook(db, U, validBook({ title: 'B', total_pages: 50 }), ctx);
  createBook(db, U, validBook({ title: 'C' }), ctx);
  const log = (book, date, s, e, m) =>
    createLog(db, U, validLog(book.id, { log_date: date, start_page: s, end_page: e, duration_minutes: m }), ctx);
  log(a, '2026-10-21', 0, 30, 20); // hari ini
  log(a, '2026-10-21', 30, 40, 10); // hari ini, sesi ke-2
  log(a, '2026-10-20', 40, 60, 30); // kemarin
  log(b, '2026-10-18', 0, 50, 45); // b selesai
  log(a, '2026-09-01', 0, 5, 5); // di luar 7 hari
  return db;
}

test('dashboard summary dihitung dari database', () => {
  const db = seedData();
  const s = getDashboardSummary(db, U, { today: TODAY });
  assert.equal(s.total_books, 3);
  assert.equal(s.reading, 1);
  assert.equal(s.finished, 1);
  assert.equal(s.unread, 1);
  assert.equal(s.pages_read, 60 + 50, 'jumlah current_page semua buku');
  assert.equal(s.pages_logged, 30 + 10 + 20 + 50 + 5);
  assert.equal(s.total_minutes, 20 + 10 + 30 + 45 + 5);
  assert.equal(s.total_sessions, 5);
  assert.equal(s.last_7_days.length, 7);
  assert.equal(s.last_7_days[0].date, '2026-10-15');
  assert.equal(s.last_7_days[6].date, TODAY);
  assert.deepEqual(s.last_7_days[6], { date: TODAY, pages: 40, minutes: 30, sessions: 2 });
  assert.deepEqual(s.last_7_days[5], { date: '2026-10-20', pages: 20, minutes: 30, sessions: 1 });
  assert.deepEqual(s.last_7_days[4], { date: '2026-10-19', pages: 0, minutes: 0, sessions: 0 });
  assert.equal(s.recent_logs.length, 5);
  assert.equal(s.recent_logs[0].log_date, TODAY);
});

test('dashboard summary pada database kosong bernilai nol, bukan error', () => {
  const s = getDashboardSummary(makeDb(), U, { today: TODAY });
  assert.equal(s.total_books, 0);
  assert.equal(s.total_minutes, 0);
  assert.equal(s.pages_read, 0);
  assert.equal(s.last_7_days.every((d) => d.pages === 0), true);
  assert.deepEqual(s.recent_logs, []);
});

test('reading-activity: rentang diisi nol dan total benar', () => {
  const db = seedData();
  const r = getReadingActivity(db, U, { from: '2026-10-17', to: '2026-10-21' });
  assert.equal(r.days.length, 5);
  assert.deepEqual(r.totals, { pages: 110, minutes: 105, sessions: 4 });
  assert.equal(r.days[0].pages, 0);
});

test('reading-habits: metrik periode 7 hari', () => {
  const db = seedData();
  const h = getReadingHabits(db, U, { days: 7, today: TODAY });
  assert.deepEqual(h.period, { from: '2026-10-15', to: TODAY, days: 7, all_time: false });
  assert.equal(h.sessions, 4);
  assert.equal(h.active_days, 3);
  assert.equal(h.total_minutes, 105);
  assert.equal(h.total_pages, 110);
  assert.equal(h.avg_minutes_per_session, 26.3);
  assert.equal(h.avg_minutes_per_active_day, 35);
  assert.equal(h.avg_minutes_per_day, 15);
  assert.equal(h.finished_books.length, 1);
  assert.equal(h.finished_books[0].title, 'B');
  assert.equal(h.finished_books_all_time, 1);
  assert.deepEqual(h.streaks, { current: 2, longest: 2 });
  assert.ok(h.definitions.current_streak);
});

test('reading-habits: periode kosong tidak membagi dengan nol', () => {
  const h = getReadingHabits(makeDb(), U, { days: 30, today: TODAY });
  assert.equal(h.avg_minutes_per_session, 0);
  assert.equal(h.avg_minutes_per_active_day, 0);
  assert.deepEqual(h.streaks, { current: 0, longest: 0 });
});

test('computeStreaks', () => {
  assert.deepEqual(computeStreaks([], TODAY), { current: 0, longest: 0 });
  assert.deepEqual(computeStreaks(['2026-10-21'], TODAY), { current: 1, longest: 1 });
  // hari ini belum membaca, kemarin ya -> streak belum putus
  assert.deepEqual(computeStreaks(['2026-10-19', '2026-10-20'], TODAY), { current: 2, longest: 2 });
  // terakhir membaca 2 hari lalu -> streak putus
  assert.deepEqual(computeStreaks(['2026-10-18', '2026-10-19'], TODAY), { current: 0, longest: 2 });
  // longest di masa lalu lebih panjang dari current
  assert.deepEqual(
    computeStreaks(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-20', '2026-10-21'], TODAY),
    { current: 2, longest: 4 },
  );
  // lintas bulan & tahun
  assert.deepEqual(computeStreaks(['2025-12-31', '2026-01-01'], '2026-01-01'), { current: 2, longest: 2 });
});

test('dashboard: target harian, ringkasan hari ini, dan buku "lanjutkan membaca"', () => {
  const db = seedData();
  const s = getDashboardSummary(db, U, { today: TODAY });
  assert.equal(s.daily_goal_pages, 30, 'default target harian');
  assert.deepEqual(s.today, { date: TODAY, pages: 40, minutes: 30, sessions: 2 });
  assert.equal(s.reading_books.length, 1);
  assert.equal(s.reading_books[0].title, 'A');
  assert.equal(s.reading_books[0].progress_percent, 60);
  assert.equal('user_id' in s.reading_books[0], false, 'user_id tidak bocor ke klien');
  db.prepare('UPDATE users SET daily_goal_pages = 50 WHERE id = ?').run(U);
  assert.equal(getDashboardSummary(db, U, { today: TODAY }).daily_goal_pages, 50);
});

test('reading-habits: periode semua waktu dihitung dari log pertama', () => {
  const db = seedData(); // log tertua 2026-09-01
  const h = getReadingHabits(db, U, { days: null, today: TODAY });
  assert.equal(h.period.all_time, true);
  assert.equal(h.period.from, '2026-09-01');
  assert.equal(h.period.days, 51);
  assert.equal(h.sessions, 5);
  assert.equal(h.active_days, 4);
  assert.equal(h.avg_pages_per_active_day, Math.round(115 / 4));
  const empty = getReadingHabits(makeDb(), U, { days: null, today: TODAY });
  assert.equal(empty.period.days, 1);
  assert.equal(empty.avg_minutes_per_day, 0);
});

test('reading-habits: rasio konsistensi', () => {
  const h = getReadingHabits(seedData(), U, { days: 7, today: TODAY });
  assert.equal(h.consistency_ratio, 0.43); // 3 hari aktif dari 7
});

test('distribusi kategori', () => {
  const db = makeDb();
  createBook(db, U, validBook({ title: 'A', category: 'Fiksi' }), ctx);
  createBook(db, U, validBook({ title: 'B', category: 'Fiksi' }), ctx);
  createBook(db, U, validBook({ title: 'C', category: 'Sejarah' }), ctx);
  createBook(db, U, validBook({ title: 'D', category: null }), ctx);
  const d = getCategoryDistribution(db, U);
  assert.equal(d.total_books, 4);
  assert.deepEqual(d.categories[0], { category: 'Fiksi', books: 2, percent: 50 });
  assert.ok(d.categories.some((c) => c.category === 'Tanpa kategori' && c.books === 1));
  assert.deepEqual(getCategoryDistribution(makeDb(), U), { total_books: 0, categories: [] });
});
