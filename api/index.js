import { createApp } from "../src/app.js";
import { getConfig } from "../src/config/env.js";
import { openDatabase } from "../src/db/connection.js";

const config = getConfig({
  ...process.env,
  DB_PATH: process.env.DB_PATH || "/tmp/tanaread.db",
  TRUST_PROXY: process.env.TRUST_PROXY || "1",
});

export default createApp({ db: openDatabase(config.dbPath), config });
