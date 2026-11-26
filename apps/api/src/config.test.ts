import { describe, expect, it } from 'vitest';
import { loadEnv, productionProblems } from './config.js';

const good = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://si_api:pw@db:5432/sampintel',
  DATABASE_ADMIN_URL: 'postgres://postgres:pw@db:5432/sampintel',
  SESSION_SECRET: 'x'.repeat(40),
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  WEB_ORIGIN: 'https://sampintel.example.com',
  COOKIE_SECURE: 'true',
};

describe('production configuration', () => {
  it('starts with safe settings', () => {
    expect(() => loadEnv(good)).not.toThrow();
    expect(productionProblems(loadEnv(good))).toEqual([]);
  });
  it.each([
    [{ COOKIE_SECURE: 'false' }, 'COOKIE_SECURE'],
    [{ WEB_ORIGIN: 'http://sampintel.example.com' }, 'WEB_ORIGIN must be https'],
    [{ SESSION_SECRET: 'CHANGE-ME'.padEnd(40, 'x') }, 'SESSION_SECRET still holds'],
    [{ DATABASE_URL: 'postgres://postgres:pw@db:5432/sampintel' }, 'owner role'],
    [{ LOGIN_RATE_LIMIT: '1000' }, 'load-test setting'],
    [{ FIELD_ENCRYPTION_KEY_PREVIOUS: Buffer.alloc(32, 1).toString('base64') }, 'must differ'],
  ])('refuses %o', (over, msg) => {
    expect(() => loadEnv({ ...good, ...over })).toThrow(msg);
  });
  it('allows local settings outside production', () => {
    expect(() => loadEnv({ ...good, NODE_ENV: 'development', COOKIE_SECURE: 'false', WEB_ORIGIN: 'http://localhost:3100' })).not.toThrow();
  });
});
