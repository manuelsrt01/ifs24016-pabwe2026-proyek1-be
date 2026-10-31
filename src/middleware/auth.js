import { getSessionUser } from '../services/authService.js';
import { UnauthorizedError } from '../utils/errors.js';

export const COOKIE_NAME = 'tanaread_session';

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k && !(k in out)) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const readSessionToken = (req) => parseCookies(req.headers.cookie)[COOKIE_NAME];

export function setSessionCookie(res, token, expires, secure) {
  res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', secure, expires, path: '/' });
}

export function clearSessionCookie(res, secure) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure, path: '/' });
}

/** Mengisi req.user (objek pengguna publik atau null) dari cookie sesi. */
export function sessionMiddleware(db) {
  return async (req, res, next) => {
    try {
      const token = readSessionToken(req);
      req.user = token ? await getSessionUser(db, token) : null;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireAuth(req, res, next) {
  if (!req.user) return next(new UnauthorizedError());
  return next();
}
