const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Tanggal kalender valid berformat YYYY-MM-DD. */
export function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const toUtc = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

export function addDays(date, n) {
  return new Date(toUtc(date) + n * 86400000).toISOString().slice(0, 10);
}

/** Selisih hari (b - a). */
export function diffDays(a, b) {
  return Math.round((toUtc(b) - toUtc(a)) / 86400000);
}

/** Daftar tanggal berurutan dari `from` sampai `to` (inklusif). */
export function dateRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Tanggal "hari ini" (YYYY-MM-DD) pada zona waktu tertentu. */
export function todayInTimezone(timeZone = 'Asia/Jakarta', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
