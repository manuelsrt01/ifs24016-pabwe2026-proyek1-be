import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { requireAuth, sessionMiddleware } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { authRouter } from './routes/auth.js';
import { booksRouter } from './routes/books.js';
import { readingLogsRouter } from './routes/readingLogs.js';
import { dashboardRouter, statisticsRouter } from './routes/stats.js';
import { todayInTimezone } from './utils/dates.js';
import { FailureLimiter } from './utils/rateLimiter.js';

/**
 * Membuat aplikasi Express. `db` dan `today` diinjeksikan agar mudah diuji.
 * Bila folder build front-end ada (client/dist), Express juga menyajikannya
 * sehingga front-end dan API berada di satu origin (tanpa masalah CORS di produksi).
 */
export function createApp({ db, config, today, limiter = new FailureLimiter() }) {
  const getToday = today ?? (() => todayInTimezone(config.timezone));
  const ctx = { db, today: getToday };
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ?? false);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', async (req, res) => {
    let dbStatus = 'ok';
    try {
      await db.prepare('SELECT 1').get();
    } catch {
      dbStatus = 'error';
    }
    res.status(dbStatus === 'ok' ? 200 : 503).json({
      status: dbStatus === 'ok' ? 'ok' : 'degraded',
      database: dbStatus,
      time: new Date().toISOString(),
    });
  });

  app.use(sessionMiddleware(db));
  app.use('/api/auth', authRouter({ db, config, limiter }));
  app.use('/api/books', requireAuth, booksRouter(ctx));
  app.use('/api/reading-logs', requireAuth, readingLogsRouter(ctx));
  app.use('/api/dashboard', requireAuth, dashboardRouter(ctx));
  app.use('/api/statistics', requireAuth, statisticsRouter(ctx));
  app.use('/api', notFoundHandler);

  const indexHtml = path.join(config.clientDist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(config.clientDist));
    // Fallback SPA untuk React Router (tanpa pola path agar kompatibel lintas versi Express)
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      return res.sendFile(indexHtml);
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
