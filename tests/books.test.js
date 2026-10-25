import assert from 'node:assert/strict';
import { test } from './runner.js';
import {
  createBook, deleteBook, getBook, listBooks, updateBook,
} from '../src/services/bookService.js';
import { createLog, listLogs } from '../src/services/logService.js';
import { U, catchError, ctx, makeDb, validBook, validLog } from './helpers.js';

test('createBook: default status belum_dibaca, progres 0, persentase dihitung', () => {
  const db = makeDb();
  const b = createBook(db, U, validBook(), ctx);
  assert.equal(b.status, 'belum_dibaca');
  assert.equal(b.current_page, 0);
  assert.equal(b.progress_percent, 0);
  assert.equal(b.finished_at, null);
  assert.deepEqual(b.log_summary, { sessions: 0, total_pages_logged: 0, total_minutes: 0 });
  assert.match(b.created_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('createBook: status diturunkan dari progres bila tidak dikirim', () => {
  const db = makeDb();
  assert.equal(createBook(db, U, validBook({ current_page: 50 }), ctx).status, 'sedang_dibaca');
  const done = createBook(db, U, validBook({ current_page: 200 }), ctx);
  assert.equal(done.status, 'selesai');
  assert.equal(done.finished_at, ctx.today);
});

test('createBook: status selesai mengisi current_page otomatis; string angka diterima', () => {
  const db = makeDb();
  const b = createBook(db, U, validBook({ status: 'selesai', total_pages: '120', finished_at: '2026-10-01' }), ctx);
  assert.equal(b.current_page, 120);
  assert.equal(b.total_pages, 120);
  assert.equal(b.finished_at, '2026-10-01');
});

test('validasi buku: field wajib dan batas angka', () => {
  const db = makeDb();
  const err = catchError(() => createBook(db, U, { title: '  ', author: '', total_pages: 0 }, ctx));
  assert.equal(err.status, 422);
  assert.equal(err.code, 'VALIDATION_ERROR');
  assert.ok(err.details.title && err.details.author && err.details.total_pages);

  assert.ok(catchError(() => createBook(db, U, validBook({ total_pages: 10.5 }), ctx)).details.total_pages);
  assert.ok(catchError(() => createBook(db, U, validBook({ total_pages: -5 }), ctx)).details.total_pages);
  assert.ok(catchError(() => createBook(db, U, validBook({ total_pages: 'abc' }), ctx)).details.total_pages);
  assert.ok(catchError(() => createBook(db, U, validBook({ current_page: -1 }), ctx)).details.current_page);
  assert.ok(catchError(() => createBook(db, U, validBook({ current_page: 201 }), ctx)).details.current_page);
  assert.ok(catchError(() => createBook(db, U, null, ctx)).details._body);
  assert.equal(listBooks(db, U, U).length, 0, 'tidak ada data yang tersimpan saat validasi gagal');
});

test('validasi buku: konsistensi status dan progres', () => {
  const db = makeDb();
  assert.ok(catchError(() => createBook(db, U, validBook({ status: 'selesai', current_page: 10 }), ctx)).details.current_page);
  assert.ok(catchError(() => createBook(db, U, validBook({ status: 'belum_dibaca', current_page: 10 }), ctx)).details.current_page);
  assert.ok(catchError(() => createBook(db, U, validBook({ status: 'sedang_dibaca', current_page: 200 }), ctx)).details.current_page);
  assert.ok(catchError(() => createBook(db, U, validBook({ status: 'tidak_ada' }), ctx)).details.status);
});

test('validasi buku: tanggal', () => {
  const db = makeDb();
  assert.ok(catchError(() => createBook(db, U, validBook({ started_at: '2026-02-30' }), ctx)).details.started_at);
  assert.ok(catchError(() => createBook(db, U, validBook({ started_at: '21/10/2026' }), ctx)).details.started_at);
  assert.ok(
    catchError(() => createBook(db, U, validBook({ current_page: 10, finished_at: '2026-10-01' }), ctx)).details.finished_at,
  );
  assert.ok(
    catchError(() =>
      createBook(db, U, validBook({ status: 'selesai', started_at: '2026-10-10', finished_at: '2026-10-01' }), ctx),
    ).details.finished_at,
  );
});

test('getBook / updateBook / deleteBook: ID tidak ada menghasilkan 404', () => {
  const db = makeDb();
  assert.equal(catchError(() => getBook(db, U, 999)).status, 404);
  assert.equal(catchError(() => updateBook(db, U, 999, validBook(), ctx)).status, 404);
  assert.equal(catchError(() => deleteBook(db, U, 999)).status, 404);
});

test('updateBook: mengganti data, mempertahankan created_at, menolak total < halaman log', () => {
  const db = makeDb();
  const b = createBook(db, U, validBook(), ctx);
  const u = updateBook(db, U, b.id, validBook({ title: 'Judul Baru', current_page: 10, status: 'sedang_dibaca' }), ctx);
  assert.equal(u.title, 'Judul Baru');
  assert.equal(u.status, 'sedang_dibaca');
  assert.equal(u.created_at, b.created_at);

  createLog(db, U, validLog(b.id, { start_page: 10, end_page: 150 }), ctx);
  const err = catchError(() => updateBook(db, U, b.id, validBook({ total_pages: 100 }), ctx));
  assert.equal(err.status, 422);
  assert.ok(err.details.total_pages);
});

test('deleteBook: reading log terkait ikut terhapus (cascade) dan buku lain tidak terpengaruh', () => {
  const db = makeDb();
  const a = createBook(db, U, validBook({ title: 'A' }), ctx);
  const b = createBook(db, U, validBook({ title: 'B' }), ctx);
  createLog(db, U, validLog(a.id), ctx);
  createLog(db, U, validLog(a.id, { start_page: 50, end_page: 90 }), ctx);
  createLog(db, U, validLog(b.id), ctx);
  deleteBook(db, U, a.id);
  assert.equal(listLogs(db, U, U).total, 1);
  assert.equal(listLogs(db, U, U).rows[0].book_id, b.id);
  assert.equal(listBooks(db, U, U).length, 1);
});

test('listBooks: pencarian judul/penulis, filter status & kategori, karakter LIKE di-escape', () => {
  const db = makeDb();
  createBook(db, U, validBook({ title: 'Laskar Pelangi', author: 'Andrea Hirata', category: 'Fiksi' }), ctx);
  createBook(db, U, validBook({ title: 'Basis Data', author: 'Budi', category: 'Teknologi', current_page: 20 }), ctx);
  createBook(db, U, validBook({ title: '100% Jujur', author: 'Cici', category: 'Fiksi' }), ctx);

  assert.equal(listBooks(db, U, { q: 'laskar' }).length, 1);
  assert.equal(listBooks(db, U, { q: 'hirata' }).length, 1);
  assert.equal(listBooks(db, U, { category: 'Fiksi' }).length, 2);
  assert.equal(listBooks(db, U, { status: 'sedang_dibaca' }).length, 1);
  assert.equal(listBooks(db, U, { q: '%' }).length, 1, '% dianggap karakter biasa');
  assert.equal(listBooks(db, U, { q: '_' }).length, 0, '_ dianggap karakter biasa');
  assert.equal(listBooks(db, U, { q: "'; DROP TABLE books;--" }).length, 0);
  assert.equal(listBooks(db, U, U).length, 3, 'tabel masih utuh');
});
