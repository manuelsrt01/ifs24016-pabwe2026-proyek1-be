// Pintu masuk serverless untuk Vercel: membungkus aplikasi Express yang sama dengan src/server.js.
// Produksi: isi TURSO_DATABASE_URL dan TURSO_AUTH_TOKEN (integrasi Turso di Vercel Marketplace) agar data tersimpan permanen.
// Tanpa itu, database jatuh ke file SQLite di /tmp yang sementara dan hilang saat fungsi tidur.
// Opsional: DEMO_SEED=true membuat akun demo (demo@tanaread.test / demo12345) bila belum ada.
import { createApp } from '../src/app.js';
import { getConfig } from '../src/config/env.js';
import { openDatabase } from '../src/db/connection.js';
import { hasDemoUser, seedDemoData } from '../src/db/demoData.js';

const config = getConfig({
  ...process.env,
  DB_PATH: process.env.DB_PATH || '/tmp/tanaread.db',
  TRUST_PROXY: process.env.TRUST_PROXY || '1',
});

const db = await openDatabase(config.dbTarget, config.dbAuthToken);
if (process.env.DEMO_SEED === 'true' && !(await hasDemoUser(db))) {
  await seedDemoData(db, config.timezone);
}

export default createApp({ db, config });
