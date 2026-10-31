import { loadEnvFile, getConfig } from '../config/env.js';
import { openDatabase } from './connection.js';
import { SCHEMA_VERSION, currentVersion } from './schema.js';

loadEnvFile();
const config = getConfig();
const db = await openDatabase(config.dbTarget, config.dbAuthToken);
console.log(`Database siap: ${db.url} (versi skema ${await currentVersion(db)}/${SCHEMA_VERSION})`);
db.close();
