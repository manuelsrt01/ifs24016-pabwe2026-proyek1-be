import { BadRequestError, ValidationError } from '../utils/errors.js';
import { isValidDate } from '../utils/dates.js';
import { isBlank, parseInteger } from '../validators/common.js';

export function parseId(value, label = 'ID') {
  const id = parseInteger(value);
  if (!Number.isInteger(id) || id <= 0) throw new BadRequestError(`${label} harus berupa bilangan bulat positif`, 'INVALID_ID');
  return id;
}

/** Mengambil query string sebagai teks ter-trim, atau undefined. */
export function queryText(v) {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

export function queryDate(v, key, errors) {
  if (isBlank(v)) return undefined;
  if (typeof v !== 'string' || !isValidDate(v)) {
    errors[key] = 'Harus berformat YYYY-MM-DD yang valid';
    return undefined;
  }
  return v;
}

export function queryInt(v, key, { min, max, fallback }, errors) {
  if (isBlank(v)) return fallback;
  const n = parseInteger(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    errors[key] = `Harus bilangan bulat ${min}–${max}`;
    return fallback;
  }
  return n;
}

export function throwIfErrors(errors) {
  if (Object.keys(errors).length) throw new ValidationError(errors, 'Parameter query tidak valid');
}
