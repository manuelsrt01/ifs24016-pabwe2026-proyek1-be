/**
 * Migrasi skema berbasis PRAGMA user_version.
 * Aman dijalankan berulang: hanya migrasi dengan nomor > user_version yang dieksekusi.
 * Untuk mengubah skema di masa depan, TAMBAHKAN entri baru; jangan mengubah entri lama.
 */
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export const MIGRATIONS = [
  // v1: tabel awal. Setiap elemen = SATU statement SQL (kompatibel bun:sqlite & node:sqlite).
  [
    `CREATE TABLE IF NOT EXISTS books (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      title         TEXT    NOT NULL CHECK (length(trim(title)) > 0),
      author        TEXT    NOT NULL CHECK (length(trim(author)) > 0),
      category      TEXT,
      total_pages   INTEGER NOT NULL CHECK (total_pages > 0),
      current_page  INTEGER NOT NULL DEFAULT 0,
      status        TEXT    NOT NULL DEFAULT 'belum_dibaca'
                    CHECK (status IN ('belum_dibaca','sedang_dibaca','selesai')),
      started_at    TEXT,
      finished_at   TEXT,
      notes         TEXT,
      created_at    TEXT    NOT NULL DEFAULT (${NOW}),
      updated_at    TEXT    NOT NULL DEFAULT (${NOW}),
      CHECK (current_page >= 0 AND current_page <= total_pages),
      CHECK ((status = 'selesai') = (current_page = total_pages)),
      CHECK (status <> 'belum_dibaca' OR current_page = 0),
      CHECK (finished_at IS NULL OR status = 'selesai')
    )`,
    `CREATE TABLE IF NOT EXISTS reading_logs (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id          INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      log_date         TEXT    NOT NULL,
      start_page       INTEGER NOT NULL CHECK (start_page >= 0),
      end_page         INTEGER NOT NULL,
      pages_read       INTEGER NOT NULL,
      duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
      notes            TEXT,
      created_at       TEXT    NOT NULL DEFAULT (${NOW}),
      updated_at       TEXT    NOT NULL DEFAULT (${NOW}),
      CHECK (end_page >= start_page),
      CHECK (pages_read = end_page - start_page)
    )`,
    'CREATE INDEX IF NOT EXISTS idx_books_status   ON books(status)',
    'CREATE INDEX IF NOT EXISTS idx_books_category ON books(category)',
    'CREATE INDEX IF NOT EXISTS idx_logs_book_id   ON reading_logs(book_id)',
    'CREATE INDEX IF NOT EXISTS idx_logs_log_date  ON reading_logs(log_date)',
  ],
  // v2: autentikasi. users + sessions, dan kepemilikan buku (books.user_id).
  // Catatan: SQLite tidak dapat menambah kolom NOT NULL berreferensi lewat ALTER TABLE;
  // user_id wajib diisi oleh service (buku tanpa pemilik tidak pernah terlihat oleh siapa pun).
  [
    `CREATE TABLE IF NOT EXISTS users (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      name             TEXT    NOT NULL CHECK (length(trim(name)) > 0),
      email            TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      password_hash    TEXT    NOT NULL,
      daily_goal_pages INTEGER NOT NULL DEFAULT 30 CHECK (daily_goal_pages > 0 AND daily_goal_pages <= 10000),
      created_at       TEXT    NOT NULL DEFAULT (${NOW}),
      updated_at       TEXT    NOT NULL DEFAULT (${NOW})
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT    NOT NULL DEFAULT (${NOW}),
      expires_at TEXT    NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)',
    'ALTER TABLE books ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE',
    'CREATE INDEX IF NOT EXISTS idx_books_user_id ON books(user_id)',
  ],
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function migrate(db) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = current; v < MIGRATIONS.length; v += 1) {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const statement of MIGRATIONS[v]) db.exec(statement);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
