import { registerUser } from '../services/authService.js';
import { createBook } from '../services/bookService.js';
import { createLog } from '../services/logService.js';
import { addDays, todayInTimezone } from '../utils/dates.js';

export const DEMO_EMAIL = 'demo@tanaread.test';
export const DEMO_PASSWORD = 'demo12345';

/** Apakah akun demo sudah ada di database ini. */
export const hasDemoUser = async (db) => Boolean(await db.prepare('SELECT id FROM users WHERE email = ?').get(DEMO_EMAIL));

/**
 * Mengisi satu akun demo beserta beberapa buku dan catatan membaca.
 * Dipakai oleh `bun run seed` (lokal) dan, secara opt-in, oleh deployment demo di Vercel.
 */
export async function seedDemoData(db, timezone) {
  const user = await registerUser(db, { name: 'Pembaca Budiman', email: DEMO_EMAIL, password: DEMO_PASSWORD });
  const today = todayInTimezone(timezone);
  const ctx = { today };
  const day = (offset) => addDays(today, offset);

  const mk = (title, author, category, total_pages, extra = {}) =>
    createBook(db, user.id, { title, author, category, total_pages, status: 'belum_dibaca', ...extra }, ctx);
  const log = (book, offset, start, end, minutes, notes) =>
    createLog(db, user.id, { book_id: book.id, log_date: day(offset), start_page: start, end_page: end, duration_minutes: minutes, notes }, ctx);

  // Dijalankan berurutan: buku dibuat dulu, baru log-nya, supaya hasilnya sama setiap kali.

  const filosofi = await mk('Filosofi Teras', 'Henry Manampiring', 'Self-Development', 346);
  const atomic = await mk('Atomic Habits', 'James Clear', 'Self-Development', 320);
  const bumi = await mk('Bumi Manusia', 'Pramoedya Ananta Toer', 'Fiksi / Sastra', 535);
  await mk('Dune', 'Frank Herbert', 'Fiksi / Sci-Fi', 680);
  const sapiens = await mk('Sapiens: Riwayat Singkat Umat Manusia', 'Yuval Noah Harari', 'Sejarah', 512);
  await mk('Psychology of Money', 'Morgan Housel', 'Keuangan', 252, { status: 'selesai', finished_at: day(-12) });

  await log(bumi, -5, 120, 150, 40, 'Perjalanan ke Wonokromo.');
  await log(filosofi, -4, 310, 346, 55, 'Menyelesaikan bab penutup tentang Amor Fati.');
  await log(atomic, -3, 165, 190, 35, 'Mendesain lingkungan agar isyarat kebiasaan terlihat jelas.');
  await log(sapiens, -2, 280, 310, 60, 'Revolusi Industri dan dampaknya pada struktur keluarga.');
  await log(bumi, -1, 150, 180, 50, 'Awal bab perkenalan tokoh Minke dengan Annelies.');
  await log(atomic, 0, 190, 215, 45, 'Membaca bab tentang habit stacking sebelum tidur.');

  return { email: DEMO_EMAIL, password: DEMO_PASSWORD };
}
