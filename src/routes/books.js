import { Router } from 'express';
import { createBook, deleteBook, getBook, listBooks, updateBook } from '../services/bookService.js';
import { listLogsForBook } from '../services/logService.js';
import { STATUSES } from '../validators/book.js';
import { ValidationError } from '../utils/errors.js';
import { parseId, queryText } from './helpers.js';

export function booksRouter({ db, today }) {
  const router = Router();

  router.get('/', async (req, res) => {
    const q = queryText(req.query.q);
    const status = queryText(req.query.status);
    const category = queryText(req.query.category);
    if (status && !STATUSES.includes(status)) {
      throw new ValidationError({ status: `Status harus salah satu dari: ${STATUSES.join(', ')}` }, 'Parameter query tidak valid');
    }
    const data = await listBooks(db, req.user.id, { q, status, category });
    res.json({ data, meta: { total: data.length } });
  });

  router.post('/', async (req, res) => {
    const book = await createBook(db, req.user.id, req.body, { today: today() });
    res.status(201).location(`/api/books/${book.id}`).json({ data: book });
  });

  router.get('/:id', async (req, res) => {
    res.json({ data: await getBook(db, req.user.id, parseId(req.params.id)) });
  });

  router.put('/:id', async (req, res) => {
    res.json({ data: await updateBook(db, req.user.id, parseId(req.params.id), req.body, { today: today() }) });
  });

  router.delete('/:id', async (req, res) => {
    await deleteBook(db, req.user.id, parseId(req.params.id));
    res.status(204).end();
  });

  router.get('/:id/logs', async (req, res) => {
    const data = await listLogsForBook(db, req.user.id, parseId(req.params.id));
    res.json({ data, meta: { total: data.length } });
  });

  return router;
}
