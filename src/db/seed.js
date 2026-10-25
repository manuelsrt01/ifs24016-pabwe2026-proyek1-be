/**
 * Seed data DEMO untuk lingkungan lokal. Dijalankan manual: `bun run seed`.
 * - Tidak pernah dijalankan otomatis saat server start.
 * - Menolak berjalan bila NODE_ENV=production (kecuali --force).
 * - Membuat akun demo: demo@tanaread.test / demo12345 (HANYA untuk lokal; jangan dipakai di produksi).
 */
import { getConfig, loadEnvFile } from '../config/env.js';
import { registerUser } from '../services/authService.js';
import { createBook } from '../services/bookService.js';
import { createLog } from '../services/logService.js';
import { addDays, todayInTimezone } from '../utils/dates.js';
import { openDatabase } from './connection.js';

loadEnvFile();
const config = getConfig();
const force = process.argv.includes('--force');

if (config.nodeEnv === 'production' && !force) {
  console.error('Seed ditolak: NODE_ENV=production. Gunakan --force bila benar-benar yakin.');
  process.exit(1);
}

const DEMO_EMAIL = 'demo@tanaread.test';
const db = openDatabase(config.dbPath);
if (db.prepare('SELECT id FROM users WHERE email = ?').get(DEMO_EMAIL)) {
  console.error(`Seed dibatalkan: akun ${DEMO_EMAIL} sudah ada.`);
  db.close();
  process.exit(1);
}

const user = await registerUser(db, { name: 'Pembaca Budiman', email: DEMO_EMAIL, password: 'demo12345' });
const today = todayInTimezone(config.timezone);
const ctx = { today };
const day = (offset) => addDays(today, offset);

const mk = (title, author, category, total_pages, extra = {}) =>
  createBook(db, user.id, { title, author, category, total_pages, status: 'belum_dibaca', ...extra }, ctx);
const log = (book, offset, start, end, minutes, notes) =>
  createLog(db, user.id, { book_id: book.id, log_date: day(offset), start_page: start, end_page: end, duration_minutes: minutes, notes }, ctx);

const filosofi = mk('Filosofi Teras', 'Henry Manampiring', 'Self-Development', 346);
const atomic = mk('Atomic Habits', 'James Clear', 'Self-Development', 320);
const bumi = mk('Bumi Manusia', 'Pramoedya Ananta Toer', 'Fiksi / Sastra', 535);
mk('Dune', 'Frank Herbert', 'Fiksi / Sci-Fi', 680);
const sapiens = mk('Sapiens: Riwayat Singkat Umat Manusia', 'Yuval Noah Harari', 'Sejarah', 512);
mk('Psychology of Money', 'Morgan Housel', 'Keuangan', 252, { status: 'selesai', finished_at: day(-12) });

log(bumi, -5, 120, 150, 40, 'Perjalanan ke Wonokromo.');
log(filosofi, -4, 310, 346, 55, 'Menyelesaikan bab penutup tentang Amor Fati.');
log(atomic, -3, 165, 190, 35, 'Mendesain lingkungan agar isyarat kebiasaan terlihat jelas.');
log(sapiens, -2, 280, 310, 60, 'Revolusi Industri dan dampaknya pada struktur keluarga.');
log(bumi, -1, 150, 180, 50, 'Awal bab perkenalan tokoh Minke dengan Annelies.');
log(atomic, 0, 190, 215, 45, 'Membaca bab tentang habit stacking sebelum tidur.');

console.log(`Seed demo selesai pada ${config.dbPath}`);
console.log(`Masuk dengan ${DEMO_EMAIL} / demo12345`);
db.close();
