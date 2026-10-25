import { Router } from 'express';
import {
  getCategoryDistribution, getDashboardSummary, getReadingActivity, getReadingHabits,
} from '../services/statsService.js';
import { addDays, diffDays } from '../utils/dates.js';
import { queryDate, queryInt, throwIfErrors } from './helpers.js';

export const MAX_ACTIVITY_DAYS = 366;

export function dashboardRouter({ db, today }) {
  const router = Router();
  router.get('/summary', (req, res) => {
    res.json({ data: getDashboardSummary(db, req.user.id, { today: today() }) });
  });
  return router;
}

export function statisticsRouter({ db, today }) {
  const router = Router();

  router.get('/reading-activity', (req, res) => {
    const errors = {};
    const t = today();
    const to = queryDate(req.query.to, 'to', errors) ?? t;
    const from = queryDate(req.query.from, 'from', errors) ?? addDays(to, -29);
    if (!errors.from && !errors.to) {
      if (from > to) errors.from = 'Tanggal awal tidak boleh setelah tanggal akhir';
      else if (diffDays(from, to) + 1 > MAX_ACTIVITY_DAYS) {
        errors.from = `Rentang maksimal ${MAX_ACTIVITY_DAYS} hari`;
      }
    }
    throwIfErrors(errors);
    res.json({ data: getReadingActivity(db, req.user.id, { from, to }) });
  });

  // ?days=1..365 atau ?days=all (seluruh riwayat)
  router.get('/reading-habits', (req, res) => {
    const errors = {};
    let days;
    if (req.query.days === 'all') days = null;
    else days = queryInt(req.query.days, 'days', { min: 1, max: 365, fallback: 30 }, errors);
    throwIfErrors(errors);
    res.json({ data: getReadingHabits(db, req.user.id, { days, today: today() }) });
  });

  router.get('/categories', (req, res) => {
    res.json({ data: getCategoryDistribution(db, req.user.id) });
  });

  return router;
}
