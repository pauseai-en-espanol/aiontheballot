import { expect, test } from '@playwright/test';

import { PLATFORM_HOST, PLAUSIBLE_URL, PORTS, SEED_HOSTS, TENANT_URL } from '../servers.js';

interface Received {
  userAgent?: string;
  forwardedFor?: string;
  contentType?: string;
  cookie?: string;
  body: string;
}

test.describe('analytics (PLAN R83)', () => {
  test("loads the tenant's Plausible script from the site and relays its events: nothing leaves the site, no cookie", async ({
    page,
    request,
    context,
  }) => {
    const urls: string[] = [];
    page.on('request', (sent) => urls.push(sent.url()));
    // A marker in the address tells this view from those of tests running alongside.
    const url = `${TENANT_URL}/?e2e=${crypto.randomUUID()}`;
    // What the gateway adds in production, from the documentation range. Without it Next fills in the socket's
    // address, a loopback one, which the relay never sends: every such visitor would be one.
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': '198.51.100.1, 203.0.113.50' });

    await page.goto(url);
    const userAgent = (await page.evaluate('navigator.userAgent')) as string;

    const mine = async () =>
      ((await (await request.get(`${PLAUSIBLE_URL}/received`)).json()) as Received[]).filter(
        (event) => event.body.includes(url),
      );
    await expect.poll(async () => (await mine()).length).toBe(1);
    const [event] = await mine();
    // As the script sent it: the relay writes it out again as parsed, which for the script's JSON is the same.
    expect(JSON.parse(event?.body ?? '')).toEqual({
      n: 'pageview',
      v: 0,
      u: url,
      d: SEED_HOSTS.canonical,
      r: null,
    });
    expect(event).toMatchObject({ userAgent, contentType: 'text/plain' });
    // The gateway's entry, the last; never a cookie.
    expect(event?.forwardedFor).toBe('203.0.113.50');
    expect(event?.cookie).toBeUndefined();

    expect(urls).toContain(`${TENANT_URL}/_relay/views.js`);
    expect(urls).toContain(`${TENANT_URL}/_relay/views`);
    expect([...new Set(urls.map((sent) => new URL(sent).host))]).toEqual([
      new URL(TENANT_URL).host,
    ]);
    expect(await context.cookies()).toEqual([]);
  });

  test("loads nothing on a host without a Plausible site, or on a missing page: that isn't a page view", async ({
    page,
  }) => {
    const urls: string[] = [];
    page.on('request', (sent) => urls.push(sent.url()));

    await page.goto(`http://${PLATFORM_HOST}:${PORTS.web}/ejemplo-b`);
    await page.waitForLoadState('networkidle');
    expect((await page.goto(`${TENANT_URL}/no-existe`))?.status()).toBe(404);
    await page.waitForLoadState('networkidle');

    expect(urls.filter((sent) => sent.includes('/_relay/views'))).toEqual([]);
  });
});
