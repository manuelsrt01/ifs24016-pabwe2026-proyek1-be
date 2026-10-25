import { Router } from 'express';
import { createLog, deleteLog, getLog, listLogs, updateLog } from '../services/logService.js';
import { parseId, queryDate, queryInt, throwIfErrors } from './helpers.js';

export function readingLogsRouter({ db, today }) {
  const router = Router();

  router.get('/', (req, res) => {
    const errors = {};
    const bookId = queryInt(req.query.book_id, 'book_id', { min: 1, max: Number.MAX_SAFE_INTEGER, fallback: undefined }, errors);
    const from = queryDate(req.query.from, 'from', errors);
    const to = queryDate(req.query.to, 'to', errors);
    const limit = queryInt(req.query.limit, 'limit', { min: 1, max: 200, fallback: 50 }, errors);
    const offset = queryInt(req.query.offset, 'offset', { min: 0, max: Number.MAX_SAFE_INTEGER, fallback: 0 }, errors);
    throwIfErrors(errors);
    const { rows, total } = listLogs(db, req.user.id, { bookId, from, to, limit, offset });
    res.json({ data: rows, meta: { total, limit, offset } });
  });

  router.post('/', (req, res) => {
    const log = createLog(db, req.user.id, req.body, { today: today() });
    res.status(201).location(`/api/reading-logs/${log.id}`).json({ data: log });
  });

  router.get('/:id', (req, res) => {
    res.json({ data: getLog(db, req.user.id, parseId(req.params.id)) });
  });

  router.put('/:id', (req, res) => {
    res.json({ data: updateLog(db, req.user.id, parseId(req.params.id), req.body, { today: today() }) });
  });

  router.delete('/:id', (req, res) => {
    deleteLog(db, req.user.id, parseId(req.params.id));
    res.status(204).end();
  });

  return router;
}
