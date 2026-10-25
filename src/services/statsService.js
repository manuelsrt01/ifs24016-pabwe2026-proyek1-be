import { addDays, dateRange, diffDays } from '../utils/dates.js';
import { listReadingBooks } from './bookService.js';

const round1 = (n) => Math.round(n * 10) / 10;

/** Ringkasan harian untuk rentang tanggal; hari tanpa aktivitas diisi 0. */
export function dailyActivity(db, userId, from, to) {
  const rows = db
    .prepare(
      `SELECT l.log_date AS date,
              SUM(l.pages_read) AS pages,
              SUM(l.duration_minutes) AS minutes,
              COUNT(*) AS sessions
         FROM reading_logs l JOIN books b ON b.id = l.book_id
        WHERE b.user_id = ? AND l.log_date BETWEEN ? AND ?
        GROUP BY l.log_date`,
    )
    .all(userId, from, to);
  const byDate = new Map(rows.map((r) => [r.date, { ...r }]));
  return dateRange(from, to).map(
    (date) => byDate.get(date) ?? { date, pages: 0, minutes: 0, sessions: 0 },
  );
}

export function getDashboardSummary(db, userId, { today }) {
  const books = db
    .prepare(
      `SELECT COUNT(*) AS total_books,
              COALESCE(SUM(status = 'sedang_dibaca'), 0) AS reading,
              COALESCE(SUM(status = 'selesai'), 0) AS finished,
              COALESCE(SUM(status = 'belum_dibaca'), 0) AS unread,
              COALESCE(SUM(current_page), 0) AS pages_read
         FROM books WHERE user_id = ?`,
    )
    .get(userId);
  const logs = db
    .prepare(
      `SELECT COALESCE(SUM(l.duration_minutes), 0) AS total_minutes,
              COALESCE(SUM(l.pages_read), 0) AS pages_logged,
              COUNT(*) AS total_sessions
         FROM reading_logs l JOIN books b ON b.id = l.book_id WHERE b.user_id = ?`,
    )
    .get(userId);
  const recent = db
    .prepare(
      `SELECT l.id, l.book_id, b.title AS book_title, l.log_date, l.start_page, l.end_page,
              l.pages_read, l.duration_minutes, l.notes
         FROM reading_logs l JOIN books b ON b.id = l.book_id
        WHERE b.user_id = ?
        ORDER BY l.log_date DESC, l.id DESC LIMIT 5`,
    )
    .all(userId);
  const { daily_goal_pages: goal } = db.prepare('SELECT daily_goal_pages FROM users WHERE id = ?').get(userId);
  const last7 = dailyActivity(db, userId, addDays(today, -6), today);

  return {
    total_books: books.total_books,
    reading: books.reading,
    finished: books.finished,
    unread: books.unread,
    pages_read: books.pages_read,
    pages_logged: logs.pages_logged,
    total_minutes: logs.total_minutes,
    total_sessions: logs.total_sessions,
    daily_goal_pages: goal,
    today: last7[last7.length - 1],
    last_7_days: last7,
    reading_books: listReadingBooks(db, userId, 5),
    recent_logs: recent.map((r) => ({ ...r })),
  };
}

export function getReadingActivity(db, userId, { from, to }) {
  const days = dailyActivity(db, userId, from, to);
  return {
    from,
    to,
    days,
    totals: {
      pages: days.reduce((s, d) => s + d.pages, 0),
      minutes: days.reduce((s, d) => s + d.minutes, 0),
      sessions: days.reduce((s, d) => s + d.sessions, 0),
    },
  };
}

/**
 * Menghitung streak dari daftar tanggal aktif (unik, urut menaik).
 *  - current: jumlah hari berturut-turut yang berakhir pada `today`, atau pada kemarin
 *             bila hari ini belum membaca (streak belum putus). 0 bila tidak ada.
 *  - longest: rangkaian hari berturut-turut terpanjang sepanjang riwayat.
 */
export function computeStreaks(activeDatesAsc, today) {
  const set = new Set(activeDatesAsc);
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const d of activeDatesAsc) {
    run = prev !== null && diffDays(prev, d) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  let cursor = set.has(today) ? today : addDays(today, -1);
  let current = 0;
  while (set.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  return { current, longest };
}

/** days = bilangan bulat (hari terakhir termasuk hari ini) atau null untuk "semua waktu". */
export function getReadingHabits(db, userId, { days, today }) {
  const own = 'b.user_id = ?';
  const allDates = db
    .prepare(
      `SELECT DISTINCT l.log_date FROM reading_logs l JOIN books b ON b.id = l.book_id
        WHERE ${own} ORDER BY l.log_date ASC`,
    )
    .all(userId)
    .map((r) => r.log_date);

  let from;
  let periodDays = days;
  if (days === null) {
    from = allDates.length ? allDates[0] : today;
    periodDays = Math.max(1, diffDays(from, today) + 1);
  } else {
    from = addDays(today, -(days - 1));
  }

  const t = db
    .prepare(
      `SELECT COALESCE(SUM(l.pages_read), 0) AS total_pages,
              COALESCE(SUM(l.duration_minutes), 0) AS total_minutes,
              COUNT(*) AS sessions,
              COUNT(DISTINCT l.log_date) AS active_days
         FROM reading_logs l JOIN books b ON b.id = l.book_id
        WHERE ${own} AND l.log_date BETWEEN ? AND ?`,
    )
    .get(userId, from, today);

  const finished = db
    .prepare(
      `SELECT id, title, author, total_pages, finished_at FROM books
        WHERE user_id = ? AND status = 'selesai' AND finished_at BETWEEN ? AND ?
        ORDER BY finished_at DESC, id DESC`,
    )
    .all(userId, from, today)
    .map((r) => ({ ...r }));
  const { n: finishedAllTime } = db
    .prepare("SELECT COUNT(*) AS n FROM books WHERE user_id = ? AND status = 'selesai'")
    .get(userId);

  return {
    period: { from, to: today, days: periodDays, all_time: days === null },
    total_pages: t.total_pages,
    total_minutes: t.total_minutes,
    sessions: t.sessions,
    active_days: t.active_days,
    avg_minutes_per_session: t.sessions ? round1(t.total_minutes / t.sessions) : 0,
    avg_minutes_per_active_day: t.active_days ? round1(t.total_minutes / t.active_days) : 0,
    avg_minutes_per_day: round1(t.total_minutes / periodDays),
    avg_pages_per_active_day: t.active_days ? Math.round(t.total_pages / t.active_days) : 0,
    consistency_ratio: Math.round((t.active_days / periodDays) * 100) / 100,
    streaks: computeStreaks(allDates, today),
    finished_books: finished,
    finished_books_all_time: finishedAllTime,
    definitions: {
      active_days: 'Jumlah tanggal berbeda yang memiliki minimal satu reading log dalam periode.',
      avg_minutes_per_session: 'Total menit dibagi jumlah sesi (log) dalam periode.',
      avg_minutes_per_active_day: 'Total menit dibagi jumlah hari aktif dalam periode.',
      avg_minutes_per_day: 'Total menit dibagi jumlah hari pada periode (termasuk hari tanpa membaca).',
      avg_pages_per_active_day: 'Total halaman log dibagi jumlah hari aktif dalam periode.',
      consistency_ratio: 'Hari aktif dibagi jumlah hari pada periode (0–1).',
      current_streak:
        'Hari berturut-turut dengan minimal satu log, berakhir hari ini atau kemarin (streak belum putus bila hari ini belum membaca).',
      longest_streak: 'Rangkaian hari berturut-turut terpanjang sepanjang riwayat log.',
    },
  };
}

/** Sebaran buku per kategori (seluruh koleksi pengguna). */
export function getCategoryDistribution(db, userId) {
  const rows = db
    .prepare(
      `SELECT COALESCE(NULLIF(TRIM(category), ''), 'Tanpa kategori') AS category, COUNT(*) AS books
         FROM books WHERE user_id = ?
        GROUP BY 1 ORDER BY books DESC, category ASC`,
    )
    .all(userId);
  const total = rows.reduce((s, r) => s + r.books, 0);
  return {
    total_books: total,
    categories: rows.map((r) => ({
      category: r.category,
      books: r.books,
      percent: total ? Math.round((r.books / total) * 100) : 0,
    })),
  };
}
