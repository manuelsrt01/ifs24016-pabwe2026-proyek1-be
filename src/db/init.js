import { loadEnvFile, getConfig } from '../config/env.js';
import { openDatabase } from './connection.js';
import { SCHEMA_VERSION } from './schema.js';

loadEnvFile();
const { dbPath } = getConfig();
const db = openDatabase(dbPath);
const { user_version: version } = db.prepare('PRAGMA user_version').get();
console.log(`Database siap: ${dbPath} (versi skema ${version}/${SCHEMA_VERSION})`);
db.close();
