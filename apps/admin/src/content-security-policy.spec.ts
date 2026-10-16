import { describe, expect, it } from 'vitest';

import { contentSecurityPolicy, newNonce } from './content-security-policy';

const directives = (policy: string) =>
  Object.fromEntries(
    policy.split(';').map((directive) => {
      const [name = '', ...sources] = directive.trim().split(/\s+/u);
      return [name, sources];
    }),
  );

describe('the admin Content Security Policy', () => {
  it("runs only the page's own scripts, by its nonce, and what they load", () => {
    const policy = directives(contentSecurityPolicy('bm9uY2U='));
    expect(policy['script-src']).toEqual(["'self'", "'nonce-bm9uY2U='", "'strict-dynamic'"]);
    expect(policy['script-src']).not.toContain("'unsafe-inline'");
  });

  it('allows eval only in development', () => {
    expect(contentSecurityPolicy('x')).not.toContain("'unsafe-eval'");
    expect(directives(contentSecurityPolicy('x', true))['script-src']).toContain("'unsafe-eval'");
  });

  it('loads nothing from another host, and is framed by nothing', () => {
    const policy = directives(contentSecurityPolicy('x'));
    expect(policy).toMatchObject({
      'default-src': ["'self'"],
      'connect-src': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
      'frame-src': ["'none'"],
      'base-uri': ["'none'"],
      'object-src': ["'none'"],
    });
  });

  it("shows images from the admin, inline ones, and the page's own previews of a file not yet uploaded", () => {
    expect(directives(contentSecurityPolicy('x'))['img-src']).toEqual(["'self'", 'data:', 'blob:']);
  });
});

describe('a nonce', () => {
  it('is 128 random bits in base64, new every time', () => {
    const nonces = new Set(Array.from({ length: 100 }, newNonce));
    expect(nonces.size).toBe(100);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/u);
    }
  });
});
