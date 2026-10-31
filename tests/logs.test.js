import assert from 'node:assert/strict';
import { test } from './runner.js';
import { createBook, getBook } from '../src/services/bookService.js';
import {
  createLog, deleteLog, getLog, listLogs, listLogsForBook, updateLog,
} from '../src/services/logService.js';
import { U, catchErrorAsync, ctx, makeDb, validBook, validLog } from './helpers.js';

async function setup(over) {
  const db = await makeDb();
  const book = await createBook(db, U, validBook(over), ctx);
  return { db, book };
}

test('createLog: menghitung pages_read dan memperbarui progres + status buku', async () => {
  const { db, book } = await setup();
  const log = await createLog(db, U, validLog(book.id, { start_page: 0, end_page: 50, duration_minutes: 30 }), ctx);
  assert.equal(log.pages_read, 50);
  assert.equal(log.book_title, 'Buku Uji');
  const b = await getBook(db, U, book.id);
  assert.equal(b.current_page, 50);
  assert.equal(b.status, 'sedang_dibaca');
  assert.equal(b.started_at, '2026-10-20');
  assert.equal(b.progress_percent, 25);
  assert.deepEqual(b.log_summary, { sessions: 1, total_pages_logged: 50, total_minutes: 30 });
});

test('createLog: tidak ada penghitungan ganda untuk progres (posisi, bukan penjumlahan)', async () => {
  const { db, book } = await setup();
  await createLog(db, U, validLog(book.id, { start_page: 0, end_page: 50 }), ctx);
  await createLog(db, U, validLog(book.id, { start_page: 20, end_page: 60 }), ctx); // membaca ulang hal. 20-50
  const b = await getBook(db, U, book.id);
  assert.equal(b.current_page, 60, 'progres = posisi tertinggi, bukan 50 + 40');
  assert.equal(b.log_summary.total_pages_logged, 90, 'aktivitas tetap dijumlahkan');
  // log yang berakhir di bawah progres tidak menurunkan progres
  await createLog(db, U, validLog(book.id, { start_page: 5, end_page: 10 }), ctx);
  assert.equal((await getBook(db, U, book.id)).current_page, 60);
});

test('createLog: mencapai halaman terakhir menandai buku selesai dengan finished_at = tanggal log', async () => {
  const { db, book } = await setup();
  await createLog(db, U, validLog(book.id, { start_page: 0, end_page: 120, log_date: '2026-10-10' }), ctx);
  await createLog(db, U, validLog(book.id, { start_page: 120, end_page: 200, log_date: '2026-10-15' }), ctx);
  const b = await getBook(db, U, book.id);
  assert.equal(b.status, 'selesai');
  assert.equal(b.current_page, 200);
  assert.equal(b.finished_at, '2026-10-15');
  assert.equal(b.started_at, '2026-10-10');
});

test('createLog: log bertanggal lebih awal menggeser started_at', async () => {
  const { db, book } = await setup({ status: 'sedang_dibaca', current_page: 30, started_at: '2026-10-12' });
  await createLog(db, U, validLog(book.id, { start_page: 0, end_page: 30, log_date: '2026-10-05' }), ctx);
  assert.equal((await getBook(db, U, book.id)).started_at, '2026-10-05');
});

test('validasi log', async () => {
  const { db, book } = await setup();
  const d = async (over) => (await catchErrorAsync(() => createLog(db, U, validLog(book.id, over), ctx))).details;

  assert.ok((await catchErrorAsync(() => createLog(db, U, validLog(book.id, { book_id: undefined }), ctx))).details.book_id);
  assert.ok((await d({ start_page: 50, end_page: 40 })).end_page);
  assert.ok((await d({ end_page: 201 })).end_page, 'melebihi total halaman buku');
  assert.ok((await d({ start_page: -1 })).start_page);
  assert.ok((await d({ end_page: 'x' })).end_page);
  assert.ok((await d({ duration_minutes: 0 })).duration_minutes);
  assert.ok((await d({ duration_minutes: -5 })).duration_minutes);
  assert.ok((await d({ duration_minutes: 12.5 })).duration_minutes);
  assert.ok((await d({ duration_minutes: 2000 })).duration_minutes);
  assert.ok((await d({ log_date: '2026-13-01' })).log_date);
  assert.ok((await d({ log_date: '2026-10-22' })).log_date, 'tanggal masa depan ditolak');
  assert.ok((await d({ log_date: undefined })).log_date);
  assert.equal((await listLogs(db, U, U)).total, 0, 'tidak ada log tersimpan');
  assert.equal((await getBook(db, U, book.id)).current_page, 0, 'progres tidak berubah');
});

test('createLog: buku tidak tersedia -> 422 pada book_id', async () => {
  const db = await makeDb();
  const err = await catchErrorAsync(() => createLog(db, U, validLog(999), ctx));
  assert.equal(err.status, 422);
  assert.ok(err.details.book_id);
});

test('getLog / updateLog / deleteLog: ID tidak ada -> 404', async () => {
  const { db } = await setup();
  assert.equal((await catchErrorAsync(() => getLog(db, U, 123))).status, 404);
  assert.equal((await catchErrorAsync(() => updateLog(db, U, 123, validLog(1), ctx))).status, 404);
  assert.equal((await catchErrorAsync(() => deleteLog(db, U, 123))).status, 404);
  assert.equal((await catchErrorAsync(() => listLogsForBook(db, U, 123))).status, 404);
});

test('updateLog: progres dihitung ulang dari log; buku tidak bisa dipindah', async () => {
  const { db, book } = await setup();
  const l1 = await createLog(db, U, validLog(book.id, { start_page: 0, end_page: 50 }), ctx);
  await createLog(db, U, validLog(book.id, { start_page: 50, end_page: 100 }), ctx);
  assert.equal((await getBook(db, U, book.id)).current_page, 100);

  const u = await updateLog(db, U, l1.id, validLog(book.id, { start_page: 0, end_page: 40, duration_minutes: 20 }), ctx);
  assert.equal(u.pages_read, 40);
  assert.equal((await getBook(db, U, book.id)).current_page, 100);

  const other = await createBook(db, U, validBook({ title: 'Lain' }), ctx);
  const err = await catchErrorAsync(() => updateLog(db, U, l1.id, validLog(other.id), ctx));
  assert.equal(err.status, 422);
  assert.ok(err.details.book_id);
});

test('deleteLog: log terakhir yang menentukan progres dihapus -> progres turun, status menyesuaikan', async () => {
  const { db, book } = await setup();
  await createLog(db, U, validLog(book.id, { start_page: 0, end_page: 100, log_date: '2026-10-10' }), ctx);
  const last = await createLog(db, U, validLog(book.id, { start_page: 100, end_page: 200, log_date: '2026-10-12' }), ctx);
  assert.equal((await getBook(db, U, book.id)).status, 'selesai');

  await deleteLog(db, U, last.id);
  const b = await getBook(db, U, book.id);
  assert.equal(b.current_page, 100);
  assert.equal(b.status, 'sedang_dibaca');
  assert.equal(b.finished_at, null);
  assert.equal(b.log_summary.sessions, 1);
});

test('deleteLog: menghapus satu-satunya log tidak merusak buku', async () => {
  const { db, book } = await setup();
  const l = await createLog(db, U, validLog(book.id), ctx);
  await deleteLog(db, U, l.id);
  const b = await getBook(db, U, book.id);
  assert.equal(b.log_summary.sessions, 0);
  assert.equal(b.current_page, 50, 'progres dibiarkan bila tidak ada log tersisa');
});

test('listLogs: filter, urutan terbaru dulu, pagination', async () => {
  const { db, book } = await setup();
  await createLog(db, U, validLog(book.id, { log_date: '2026-10-01', start_page: 0, end_page: 10 }), ctx);
  await createLog(db, U, validLog(book.id, { log_date: '2026-10-05', start_page: 10, end_page: 20 }), ctx);
  await createLog(db, U, validLog(book.id, { log_date: '2026-10-09', start_page: 20, end_page: 30 }), ctx);
  const all = await listLogs(db, U, {});
  assert.deepEqual(all.rows.map((r) => r.log_date), ['2026-10-09', '2026-10-05', '2026-10-01']);
  assert.equal((await listLogs(db, U, { from: '2026-10-05' })).total, 2);
  assert.equal((await listLogs(db, U, { to: '2026-10-05' })).total, 2);
  const page = await listLogs(db, U, { limit: 1, offset: 1 });
  assert.equal(page.rows.length, 1);
  assert.equal(page.rows[0].log_date, '2026-10-05');
  assert.equal(page.total, 3);
  assert.equal((await listLogsForBook(db, U, book.id)).length, 3);
});
