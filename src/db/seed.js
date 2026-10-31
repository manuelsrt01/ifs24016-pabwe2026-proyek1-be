/**
 * Seed data DEMO untuk lingkungan lokal. Dijalankan manual: `bun run seed`.
 * - Tidak dijalankan otomatis saat server start (satu-satunya pengecualian: deployment demo di Vercel
 *   yang mengaktifkan DEMO_SEED=true, lihat api/index.js).
 * - Menolak berjalan bila NODE_ENV=production (kecuali --force).
 * - Membuat akun demo: demo@tanaread.test / demo12345 (HANYA untuk lokal/demo; jangan dipakai di produksi sungguhan).
 */
import { getConfig, loadEnvFile } from '../config/env.js';
import { openDatabase } from './connection.js';
import { DEMO_EMAIL, hasDemoUser, seedDemoData } from './demoData.js';

loadEnvFile();
const config = getConfig();
const force = process.argv.includes('--force');

if (config.nodeEnv === 'production' && !force) {
  console.error('Seed ditolak: NODE_ENV=production. Gunakan --force bila benar-benar yakin.');
  process.exit(1);
}

const db = await openDatabase(config.dbTarget, config.dbAuthToken);
if (await hasDemoUser(db)) {
  console.error(`Seed dibatalkan: akun ${DEMO_EMAIL} sudah ada.`);
  db.close();
  process.exit(1);
}

const { email, password } = await seedDemoData(db, config.timezone);
console.log(`Seed demo selesai pada ${db.url}`);
console.log(`Masuk dengan ${email} / ${password}`);
db.close();
