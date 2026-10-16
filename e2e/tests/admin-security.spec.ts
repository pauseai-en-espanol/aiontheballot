import { ADMIN_URL } from '../servers.js';
import { expect, test } from '../test.js';

/** The nonce a policy names in its script-src, if any. */
const nonceOf = (policy: string | undefined): string | undefined =>
  /script-src [^;]*'nonce-([^']+)'/u.exec(policy ?? '')?.[1];

test.describe("the admin's security headers (ADR-0003: nonces in the admin)", () => {
  test('give every page a policy with a nonce of its own, which every one of its scripts carries', async ({
    request,
  }) => {
    const [first, second] = await Promise.all([
      request.get(`${ADMIN_URL}/sign-in`),
      request.get(`${ADMIN_URL}/sign-in`),
    ]);
    const policy = first.headers()['content-security-policy'];
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
    // Only `pnpm dev` allows eval: never the production build these tests run against. No inline script runs
    // without the nonce.
    expect(policy).not.toContain("'unsafe-eval'");
    expect(/script-src [^;]*'unsafe-inline'/u.test(policy ?? '')).toBe(false);
    const nonce = nonceOf(policy);
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/u);
    expect(nonceOf(second.headers()['content-security-policy'])).not.toBe(nonce);
    const scripts = [...(await first.text()).matchAll(/<script\b[^>]*>/gu)].map(
      (match) => match[0],
    );
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) {
      expect(tag).toContain(`nonce="${nonce}"`);
    }
  });

  test('send the policy and its companions on pages, routes and build assets alike', async ({
    request,
  }) => {
    const page = await request.get(`${ADMIN_URL}/sign-in`);
    const asset = /<script[^>]* src="(\/_next\/static\/[^"]+)"/u.exec(await page.text())?.[1];
    expect(asset).toBeDefined();
    // `/_next/imagex` is no build asset: the not-found page, which gets its policy too. Nor is `/_next/image`: Next's
    // image optimizer is off (PLAN R163), so it is the not-found page as well, even for the admin's own icon, which
    // the optimizer would resize (the admin doesn't route by host).
    const image = `/_next/image?url=${encodeURIComponent('/icon-32.png')}&w=64&q=75`;
    const resized = await request.get(`${ADMIN_URL}${image}`);
    expect(resized.status()).toBe(404);
    expect(await resized.text()).not.toContain('"url" parameter');
    for (const path of [
      '/sign-in',
      '/healthz',
      '/t/no-such-site',
      '/_next/imagex',
      image,
      asset ?? '',
    ]) {
      const headers = (await request.get(`${ADMIN_URL}${path}`, { maxRedirects: 0 })).headers();
      expect(headers['x-content-type-options'], path).toBe('nosniff');
      expect(headers['x-frame-options'], path).toBe('DENY');
      expect(headers['referrer-policy'], path).toBe('same-origin');
      expect(headers['strict-transport-security'], path).toBe('max-age=31536000');
      expect(headers['cross-origin-opener-policy'], path).toBe('same-origin');
      // Build assets are files, not pages: they need no nonce, and carry no policy.
      if (path === asset) {
        expect(headers['content-security-policy'], path).toBeUndefined();
      } else {
        expect(headers['content-security-policy'], path).toContain("frame-ancestors 'none'");
      }
    }
  });
});
