import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('uses defaults when nothing is set', () => {
    expect(loadConfig({})).toEqual({
      host: '0.0.0.0',
      port: 3001,
      logLevel: 'info',
      sentryDsn: undefined,
      webDatabaseUrl: undefined,
    });
  });

  it('reads values from the environment', () => {
    expect(
      loadConfig({
        HOST: '127.0.0.1',
        PORT: '4000',
        LOG_LEVEL: 'debug',
        WEB_DATABASE_URL: 'postgres://aiontheballot_web@db.example.test/aiontheballot',
      }),
    ).toEqual({
      host: '127.0.0.1',
      port: 4000,
      logLevel: 'debug',
      sentryDsn: undefined,
      webDatabaseUrl: 'postgres://aiontheballot_web@db.example.test/aiontheballot',
    });
  });

  it('reads the GlitchTip DSN', () => {
    const { sentryDsn } = loadConfig({ SENTRY_DSN: 'http://apikey@glitchtip.test/3' });
    expect(sentryDsn?.envelopeUrl).toBe(
      'http://glitchtip.test/api/3/envelope/?sentry_version=7&sentry_key=apikey',
    );
  });

  it('rejects an invalid DSN without echoing it', () => {
    expect(() => loadConfig({ SENTRY_DSN: 'http://apikey@glitchtip.test/nope' })).toThrow(
      /^SENTRY_DSN [^:]*$/,
    );
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(/PORT/);
    expect(() => loadConfig({ PORT: '70000' })).toThrow(/PORT/);
  });

  it('rejects an unknown log level', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
  });
});
