import { describe, expect, it } from 'vitest';

import { parseDsn, readDsn } from './dsn.js';

const DSN = 'http://abc123@glitchtip-web.glitchtip.svc.cluster.local/7';

describe('parseDsn', () => {
  it('splits a DSN and builds the envelope endpoint', () => {
    expect(parseDsn(DSN)).toEqual({
      value: DSN,
      publicKey: 'abc123',
      projectId: '7',
      envelopeUrl:
        'http://glitchtip-web.glitchtip.svc.cluster.local/api/7/envelope/?sentry_version=7&sentry_key=abc123',
    });
  });

  it('keeps a port and a path prefix', () => {
    expect(parseDsn('https://k@errors.example.test:8443/prefix/12').envelopeUrl).toBe(
      'https://errors.example.test:8443/prefix/api/12/envelope/?sentry_version=7&sentry_key=k',
    );
  });

  it.each([
    ['not a URL', 'not a url'],
    ['another scheme', 'ftp://k@host/1'],
    ['no public key', 'http://host/1'],
    ['a secret key', 'http://k:secret@host/1'],
    ['no project id', 'http://k@host/'],
    ['a non-numeric project id', 'http://k@host/project'],
    ['a query string', 'http://k@host/1?x=y'],
  ])('rejects %s without echoing the value', (_, value) => {
    expect(() => parseDsn(value)).toThrow(/^SENTRY_DSN /);
    try {
      parseDsn(value);
    } catch (error) {
      expect((error as Error).message).not.toContain(value);
    }
  });
});

describe('readDsn', () => {
  it('is off when SENTRY_DSN is unset or blank', () => {
    expect(readDsn({})).toBeUndefined();
    expect(readDsn({ SENTRY_DSN: '  ' })).toBeUndefined();
  });

  it('parses SENTRY_DSN when set', () => {
    expect(readDsn({ SENTRY_DSN: DSN })?.projectId).toBe('7');
  });
});
