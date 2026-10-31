import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { ConflictError, UnauthorizedError, ValidationError } from '../utils/errors.js';
import { isBlank, parseInteger, readText, requireBodyObject } from '../validators/common.js';

const scrypt = promisify(crypto.scrypt);
export const SESSION_TTL_DAYS = 14;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

// ---------- password (scrypt bawaan Node/Bun, salt acak per pengguna) ----------
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const key = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(key, expected);
}

let dummyHash; // dipakai agar waktu respons login tidak membocorkan apakah email terdaftar
const getDummyHash = async () => (dummyHash ??= await hashPassword('tidak-dipakai-untuk-login'));

// ---------- util ----------
export const publicUser = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  daily_goal_pages: row.daily_goal_pages,
  created_at: row.created_at,
});

const normalizeEmail = (v) => String(v).trim().toLowerCase();

function validateRegister(raw) {
  if (!requireBodyObject(raw)) throw new ValidationError({ _body: 'Body harus berupa objek JSON' });
  const e = {};
  const name = readText(raw, 'name', 'Nama', { required: true, max: 80 }, e);
  let email = null;
  if (isBlank(raw.email)) e.email = 'Email wajib diisi';
  else if (typeof raw.email !== 'string' || raw.email.trim().length > 254 || !EMAIL_RE.test(raw.email.trim())) {
    e.email = 'Format email tidak valid';
  } else email = normalizeEmail(raw.email);
  let password = null;
  if (isBlank(raw.password)) e.password = 'Kata sandi wajib diisi';
  else if (typeof raw.password !== 'string') e.password = 'Kata sandi harus berupa teks';
  else if (raw.password.length < PASSWORD_MIN) e.password = `Kata sandi minimal ${PASSWORD_MIN} karakter`;
  else if (raw.password.length > PASSWORD_MAX) e.password = `Kata sandi maksimal ${PASSWORD_MAX} karakter`;
  else password = raw.password;
  if (Object.keys(e).length) throw new ValidationError(e);
  return { name, email, password };
}

// ---------- registrasi & login ----------
export async function registerUser(db, raw) {
  const { name, email, password } = validateRegister(raw);
  const passwordHash = await hashPassword(password);
  try {
    const r = await db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)').run(name, email, passwordHash);
    return await getUserById(db, Number(r.lastInsertRowid));
  } catch (err) {
    if (/UNIQUE/i.test(String(err?.message))) throw new ConflictError({ email: 'Email sudah terdaftar' }, 'Email sudah terdaftar');
    throw err;
  }
}

export async function loginUser(db, raw) {
  if (!requireBodyObject(raw) || typeof raw.email !== 'string' || typeof raw.password !== 'string'
      || isBlank(raw.email) || raw.password === '') {
    throw new ValidationError({ email: 'Email dan kata sandi wajib diisi' });
  }
  const row = await db.prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(raw.email));
  const ok = await verifyPassword(raw.password, row ? row.password_hash : await getDummyHash());
  if (!row || !ok) throw new UnauthorizedError('Email atau kata sandi salah');
  return publicUser(row);
}

export async function getUserById(db, id) {
  const row = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return row ? publicUser(row) : null;
}

// ---------- sesi (token acak; yang disimpan di DB hanya hash SHA-256-nya) ----------
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export async function createSession(db, userId, now = new Date()) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 86400000);
  await db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now.toISOString());
  await db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(
    hashToken(token), userId, expiresAt.toISOString(),
  );
  return { token, expiresAt };
}

export async function getSessionUser(db, token, now = new Date()) {
  if (typeof token !== 'string' || token === '') return null;
  const id = hashToken(token);
  // Satu query (JOIN) agar hemat round-trip ke database jarak jauh.
  const row = await db
    .prepare('SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?')
    .get(id);
  if (!row) return null;
  if (row.expires_at < now.toISOString()) {
    await db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return null;
  }
  return publicUser(row);
}

export async function deleteSession(db, token) {
  if (typeof token === 'string' && token) await db.prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(token));
}

// ---------- profil & pengaturan ----------
export async function updateProfile(db, userId, raw) {
  if (!requireBodyObject(raw)) throw new ValidationError({ _body: 'Body harus berupa objek JSON' });
  const e = {};
  const hasName = !isBlank(raw.name);
  const hasGoal = !isBlank(raw.daily_goal_pages);
  const name = hasName ? readText(raw, 'name', 'Nama', { max: 80 }, e) : null;
  let goal = null;
  if (hasGoal) {
    goal = parseInteger(raw.daily_goal_pages);
    if (!Number.isInteger(goal) || goal < 1 || goal > 10000) e.daily_goal_pages = 'Target harian harus bilangan bulat 1–10000';
  }
  if (!hasName && !hasGoal) e._body = 'Tidak ada data yang diubah';
  if (Object.keys(e).length) throw new ValidationError(e);
  await db.prepare(
    `UPDATE users SET name = COALESCE(?, name), daily_goal_pages = COALESCE(?, daily_goal_pages), updated_at = ${NOW} WHERE id = ?`,
  ).run(name, goal, userId);
  return getUserById(db, userId);
}

/** Menghapus semua buku milik pengguna (reading log ikut terhapus lewat cascade). Akun tetap ada. */
export async function deleteAllUserData(db, userId) {
  await db.prepare('DELETE FROM books WHERE user_id = ?').run(userId);
}
