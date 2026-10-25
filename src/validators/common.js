export function isBlank(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/** Mengembalikan bilangan bulat, atau NaN bila bukan bilangan bulat (angka atau string angka). */
export function parseInteger(v) {
  if (typeof v === 'number') return Number.isSafeInteger(v) ? v : Number.NaN;
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) {
    const n = Number.parseInt(v.trim(), 10);
    return Number.isSafeInteger(n) ? n : Number.NaN;
  }
  return Number.NaN;
}

/**
 * Membaca field teks. Mengembalikan string ter-trim atau null.
 * Menulis pesan ke `errors[key]` bila tidak valid.
 */
export function readText(body, key, label, { required = false, max = 255 }, errors) {
  const raw = body[key];
  if (isBlank(raw)) {
    if (required) errors[key] = `${label} wajib diisi`;
    return null;
  }
  if (typeof raw !== 'string') {
    errors[key] = `${label} harus berupa teks`;
    return null;
  }
  const value = raw.trim();
  if (value.length > max) {
    errors[key] = `${label} maksimal ${max} karakter`;
    return null;
  }
  return value;
}

export function requireBodyObject(raw) {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw);
}
