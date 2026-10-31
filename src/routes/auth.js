import { Router } from 'express';
import { clearSessionCookie, readSessionToken, requireAuth, setSessionCookie } from '../middleware/auth.js';
import {
  createSession, deleteAllUserData, deleteSession, loginUser, registerUser, updateProfile,
} from '../services/authService.js';
import { TooManyRequestsError, UnauthorizedError } from '../utils/errors.js';

export function authRouter({ db, config, limiter }) {
  const router = Router();
  const startSession = async (res, user) => {
    const { token, expiresAt } = await createSession(db, user.id);
    setSessionCookie(res, token, expiresAt, config.cookieSecure);
  };

  router.post('/register', async (req, res) => {
    const user = await registerUser(db, req.body);
    await startSession(res, user);
    res.status(201).json({ data: user });
  });

  router.post('/login', async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const key = `${email}|${req.ip}`;
    if (limiter.isBlocked(key)) throw new TooManyRequestsError();
    let user;
    try {
      user = await loginUser(db, req.body);
    } catch (err) {
      if (err instanceof UnauthorizedError) limiter.fail(key);
      throw err;
    }
    limiter.reset(key);
    await startSession(res, user);
    res.json({ data: user });
  });

  router.post('/logout', async (req, res) => {
    await deleteSession(db, readSessionToken(req));
    clearSessionCookie(res, config.cookieSecure);
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req, res) => res.json({ data: req.user }));
  router.patch('/me', requireAuth, async (req, res) => res.json({ data: await updateProfile(db, req.user.id, req.body) }));
  router.delete('/me/data', requireAuth, async (req, res) => {
    await deleteAllUserData(db, req.user.id);
    res.status(204).end();
  });

  return router;
}
