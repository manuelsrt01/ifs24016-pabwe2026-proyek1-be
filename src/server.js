import { getConfig, loadEnvFile } from './config/env.js';
import { openDatabase } from './db/connection.js';
import { createApp } from './app.js';

loadEnvFile();
const config = getConfig();
const db = await openDatabase(config.dbTarget, config.dbAuthToken);
const app = createApp({ db, config });

const server = app.listen(config.port, () => {
  console.log(`TanaRead API berjalan di port ${config.port} (${config.nodeEnv})`);
  console.log(`Database: ${db.url}`);
});

function shutdown(signal) {
  console.log(`${signal} diterima, menutup server...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
