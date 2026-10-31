import fs from 'node:fs';
import path from 'node:path';
import { migrate } from './schema.js';

// Database memakai libSQL (SQLite yang kompatibel): file lokal untuk pengembangan, Turso (cloud) untuk produksi.
// Antarmukanya sengaja mirip driver SQLite sinkron (prepare().get/all/run), tetapi SEMUA metodenya async.

const REMOTE_URL = /^(libsql|https?|wss?):/i;
const KNOWN_URL = /^(file|libsql|https?|wss?):/i;

/** Mengubah path/URL apa pun menjadi URL libSQL: ':memory:' -> file::memory:, path biasa -> file:path. */
export function toDatabaseUrl(target) {
  if (target === ':memory:') return 'file::memory:';
  if (KNOWN_URL.test(target)) return target;
  return `file:${target.replace(/\\/g, '/')}`;
}

/** Baris hasil query dijadikan objek biasa; `undefined` (tidak ada baris) dijadikan null. */
const toPlain = (row) => (row ? { ...row } : null);
const toArgs = (args) => args.map((a) => (a === undefined ? null : a));

/** Membungkus client atau transaction libSQL menjadi antarmuka prepare/exec. */
function wrap(executor) {
  const execute = (sql, args = []) => executor.execute({ sql, args: toArgs(args) });
  return {
    prepare: (sql) => ({
      get: async (...args) => toPlain((await execute(sql, args)).rows[0]),
      all: async (...args) => (await execute(sql, args)).rows.map(toPlain),
      run: async (...args) => {
        const result = await execute(sql, args);
        return { changes: result.rowsAffected, lastInsertRowid: result.lastInsertRowid ?? 0n };
      },
    }),
    exec: (sql) => executor.execute(sql),
  };
}

/**
 * Membuka database lalu menjalankan migrasi. Database TIDAK pernah dihapus/di-reset di sini.
 * @param {string} target path file, ':memory:', atau URL libSQL (mis. libsql://nama-db.turso.io)
 * @param {string} [authToken] token Turso (hanya untuk database jarak jauh)
 */
export async function openDatabase(target, authToken) {
  const url = toDatabaseUrl(target);
  const remote = REMOTE_URL.test(url);
  if (!remote && url !== 'file::memory:') fs.mkdirSync(path.dirname(url.slice('file:'.length)), { recursive: true });

  // Klien "web" murni JavaScript (cocok untuk serverless); klien utama memakai binding native untuk file lokal.
  const { createClient } = await import(remote ? '@libsql/client/web' : '@libsql/client');
  const client = createClient({ url, authToken: authToken || undefined });

  const db = {
    ...wrap(client),
    url,
    batch: (statements) => client.batch(statements, 'write'),
    /** Menjalankan fn(tx) dalam satu transaksi; rollback otomatis bila fn melempar error. */
    async transaction(fn) {
      const tx = await client.transaction('write');
      try {
        const result = await fn(wrap(tx));
        await tx.commit();
        return result;
      } catch (err) {
        await tx.rollback().catch(() => {});
        throw err;
      } finally {
        tx.close();
      }
    },
    close: () => client.close(),
  };
  await migrate(db);
  return db;
}
