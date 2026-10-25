// Menyatukan API test: `bun test` memakai bun:test; node:test dipakai bila dijalankan dengan Node.
const isBun = typeof Bun !== 'undefined';
const m = isBun ? await import('bun:test') : await import('node:test');

export const test = m.test;
export const describe = m.describe;
export const before = isBun ? m.beforeAll : m.before;
export const after = isBun ? m.afterAll : m.after;
