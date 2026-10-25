/**
 * Pembatas percobaan GAGAL (mis. login) di memori. Satu instance server saja.
 * Kunci yang melebihi `max` kegagalan dalam `windowMs` diblokir sampai jendela waktu berakhir.
 */
export class FailureLimiter {
  constructor({ windowMs = 15 * 60 * 1000, max = 8, now = () => Date.now() } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.now = now;
    this.entries = new Map();
  }

  isBlocked(key) {
    const e = this.entries.get(key);
    if (!e) return false;
    if (this.now() - e.first > this.windowMs) {
      this.entries.delete(key);
      return false;
    }
    return e.count >= this.max;
  }

  fail(key) {
    const t = this.now();
    if (this.entries.size > 10000) this.prune(t);
    const e = this.entries.get(key);
    if (!e || t - e.first > this.windowMs) this.entries.set(key, { count: 1, first: t });
    else e.count += 1;
  }

  reset(key) {
    this.entries.delete(key);
  }

  prune(t = this.now()) {
    for (const [k, e] of this.entries) if (t - e.first > this.windowMs) this.entries.delete(k);
  }
}
