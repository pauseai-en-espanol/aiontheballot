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
      filesRoot: undefined,
      auth: undefined,
      adminDatabaseUrl: undefined,
      mail: undefined,
      platformHost: undefined,
    });
  });

  it('reads values from the environment', () => {
    expect(
      loadConfig({
        HOST: '127.0.0.1',
        PORT: '4000',
        LOG_LEVEL: 'debug',
        WEB_DATABASE_URL: 'postgres://aiontheballot_web@db.example.test/aiontheballot',
        FILES_ROOT: '/data/files',
      }),
    ).toEqual({
      host: '127.0.0.1',
      port: 4000,
      logLevel: 'debug',
      sentryDsn: undefined,
      webDatabaseUrl: 'postgres://aiontheballot_web@db.example.test/aiontheballot',
      filesRoot: '/data/files',
      auth: undefined,
      adminDatabaseUrl: undefined,
      mail: undefined,
      platformHost: undefined,
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

  it('reads the mail sender and the platform domain', () => {
    expect(
      loadConfig({
        SMTP_URL: 'smtps://avisos:secreto@correo.example.test:465',
        MAIL_FROM: 'avisos@example.test',
        PLATFORM_HOST: 'plataforma.example.test',
      }),
    ).toMatchObject({
      mail: {
        smtpUrl: 'smtps://avisos:secreto@correo.example.test:465',
        from: 'avisos@example.test',
      },
      platformHost: 'plataforma.example.test',
    });
  });

  it.each([
    [{ SMTP_URL: 'smtps://avisos:secreto@correo.example.test' }, /MAIL_FROM not set/],
    [{ MAIL_FROM: 'avisos@example.test' }, /SMTP_URL not set/],
    [
      { SMTP_URL: 'https://avisos:secreto@correo.example.test', MAIL_FROM: 'a@example.test' },
      /smtp/,
    ],
    [{ SMTP_URL: 'not a url secreto', MAIL_FROM: 'a@example.test' }, /SMTP_URL must be/],
    [
      { SMTP_URL: 'smtp://correo.example.test', MAIL_FROM: 'Avisos <a@example.test>' },
      /MAIL_FROM must be a plain address/,
    ],
  ])('refuses mail settings %j, never echoing the URL', (env, message) => {
    expect(() => loadConfig(env)).toThrow(message);
    expect(() => loadConfig(env)).not.toThrow(/secreto/);
  });

  it('rejects an unknown log level', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
  });

  describe('sign-in', () => {
    const SIGN_IN = {
      ADMIN_ORIGIN: 'https://admin.example.test',
      AUTH_DATABASE_URL:
        'postgres://aiontheballot_auth:auth-password@db.example.test/aiontheballot',
      BETTER_AUTH_SECRET: 'a-secret-of-at-least-thirty-two-characters!',
      PLATFORM_NAME: 'Plataforma de ejemplo',
    };

    it('reads its settings, and the admin role for signed-in requests', () => {
      const config = loadConfig({
        ...SIGN_IN,
        ADMIN_DATABASE_URL: 'postgres://aiontheballot_admin@db.example.test/aiontheballot',
      });
      expect(config.auth).toEqual({
        adminOrigin: 'https://admin.example.test',
        databaseUrl: SIGN_IN.AUTH_DATABASE_URL,
        secret: SIGN_IN.BETTER_AUTH_SECRET,
        totpIssuer: 'Plataforma de ejemplo',
      });
      expect(config.adminDatabaseUrl).toBe(
        'postgres://aiontheballot_admin@db.example.test/aiontheballot',
      );
    });

    it('is off with none of them, and refuses some without the others, naming only what is missing', () => {
      expect(loadConfig({ PLATFORM_NAME: 'Plataforma de ejemplo' }).auth).toBeUndefined();
      for (const name of Object.keys(SIGN_IN)) {
        const env: Record<string, string> = { ...SIGN_IN };
        delete env[name];
        expect(() => loadConfig(env), name).toThrow(
          new RegExp(`half configured: ${name} not set$`),
        );
      }
    });

    it('refuses a short secret without echoing it', () => {
      const secret = 'too-short-to-be-safe';
      expect(() => loadConfig({ ...SIGN_IN, BETTER_AUTH_SECRET: secret })).toThrow(
        /at least 32 characters/,
      );
      try {
        loadConfig({ ...SIGN_IN, BETTER_AUTH_SECRET: secret });
      } catch (error) {
        expect(String(error)).not.toContain(secret);
      }
    });

    it('takes an https origin, or http on a loopback host only, with no path', () => {
      const origin = (value: string) =>
        loadConfig({ ...SIGN_IN, ADMIN_ORIGIN: value }).auth?.adminOrigin;
      expect(origin('https://admin.example.test/')).toBe('https://admin.example.test');
      expect(origin('http://localhost:4105')).toBe('http://localhost:4105');
      expect(origin('http://admin.localhost:3002')).toBe('http://admin.localhost:3002');
      expect(origin('http://127.0.0.1:4105')).toBe('http://127.0.0.1:4105');
      for (const value of [
        'http://admin.example.test',
        'https://admin.example.test/admin',
        'https://admin.example.test?x=1',
        'https://user@admin.example.test',
        'ftp://admin.example.test',
        'admin.example.test',
      ]) {
        expect(() => origin(value), value).toThrow(/ADMIN_ORIGIN/);
      }
      expect(() => origin('https://user:secret-password@admin.example.test')).toThrow(
        /^(?!.*secret-password)/,
      );
    });
  });
});
