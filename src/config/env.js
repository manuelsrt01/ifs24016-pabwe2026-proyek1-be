import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Memuat server/.env bila ada. Variabel yang sudah ada di environment tidak ditimpa.
 * Bun memuat file .env dari folder kerja secara otomatis, jadi tidak perlu dilakukan manual.
 */
export function loadEnvFile() {
  if (typeof Bun !== 'undefined') return;
  try {
    process.loadEnvFile(path.join(SERVER_ROOT, '.env'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

export function getConfig(env = process.env) {
  const port = Number.parseInt(env.PORT ?? '3000', 10);
  return {
    nodeEnv: env.NODE_ENV || 'development',
    port: Number.isInteger(port) ? port : 3000,
    dbPath: env.DB_PATH ? path.resolve(env.DB_PATH) : path.join(SERVER_ROOT, 'data', 'tanaread.db'),
    timezone: env.APP_TIMEZONE || 'Asia/Jakarta',
    corsOrigins: (env.CORS_ORIGIN || 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    // Cookie sesi bertanda Secure di produksi (butuh HTTPS). Ubah dengan COOKIE_SECURE=true|false.
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : (env.NODE_ENV || 'development') === 'production',
    // Jumlah proxy tepercaya di depan server (mis. 1 bila di belakang reverse proxy/PaaS); 0 = tidak ada.
    trustProxy: Number.parseInt(env.TRUST_PROXY ?? '0', 10) || false,
    clientDist: env.CLIENT_DIST_DIR
      ? path.resolve(env.CLIENT_DIST_DIR)
      : path.resolve(SERVER_ROOT, '../dist'),
  };
}
