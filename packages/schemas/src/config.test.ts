import { describe, it, expect } from 'vitest';
import { readConfig } from './config.js';
const valid = {
  APP_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://user:password@localhost/db',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_SECRET: 'test-secret-that-is-at-least-32-characters',
};
describe('configuration', () => {
  it('uses installation defaults', () =>
    expect(readConfig(valid).INSTALLATION_CURRENCY).toBe('USD'));
  it('requires dependencies and a secret', () => {
    expect(() => readConfig({})).toThrow('Invalid configuration');
    expect(() => readConfig({ ...valid, SESSION_SECRET: 'short' })).toThrow(
      'SESSION_SECRET',
    );
  });
  it('rejects invalid protocols, ports, currencies and URL paths', () => {
    for (const change of [
      { DATABASE_URL: 'http://localhost' },
      { REDIS_URL: 'http://localhost' },
      { API_PORT: '0' },
      { INSTALLATION_CURRENCY: 'ZZZ' },
      { APP_URL: 'http://localhost/app' },
    ])
      expect(() => readConfig({ ...valid, ...change })).toThrow();
  });
  it('requires HTTPS and non-example secrets in production', () => {
    expect(() => readConfig({ ...valid, NODE_ENV: 'production' })).toThrow(
      'HTTPS',
    );
    expect(() =>
      readConfig({
        ...valid,
        NODE_ENV: 'production',
        APP_URL: 'https://salon.example.test',
        SESSION_SECRET: 'development-example-secret-32-characters',
      }),
    ).toThrow('secret');
  });
  it('requires complete optional settings', () => {
    expect(() => readConfig({ ...valid, EMAIL_PROVIDER: 'smtp' })).toThrow(
      'SMTP',
    );
    expect(() =>
      readConfig({ ...valid, OBJECT_STORAGE_BUCKET: 'test' }),
    ).toThrow('storage');
  });
  it('never includes secret values in errors', () => {
    try {
      readConfig({ ...valid, DATABASE_URL: 'highly-sensitive-invalid-secret' });
    } catch (e) {
      expect(String(e)).not.toContain('highly-sensitive');
    }
  });
});
