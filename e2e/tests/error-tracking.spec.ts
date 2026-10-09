import { type APIRequestContext, expect, test } from '@playwright/test';

import { ADMIN_URL, DSNS, GLITCHTIP_URL, WEB_URL } from '../servers.js';

interface Received {
  path: string;
  query: string;
  body: string;
}

interface SentEvent {
  release?: string;
  user?: unknown;
  request?: { url?: string; headers?: Record<string, string> };
  exception?: { values?: { value?: string }[] };
}

const RELAY_PATH = '/_relay/errors';

/** Waits until the fake GlitchTip has received an envelope containing `marker`. */
const waitForEnvelope = async (request: APIRequestContext, marker: string): Promise<Received> => {
  let found: Received | undefined;
  await expect
    .poll(
      async () => {
        const received = (await (
          await request.get(`${GLITCHTIP_URL}/received`)
        ).json()) as Received[];
        found = received.find(({ body }) => body.includes(marker));
        return found;
      },
      { timeout: 10_000 },
    )
    .toBeDefined();
  return found as Received;
};

/** Splits an envelope into its header and the payload of its first event item. */
const parseEnvelope = (body: string) => {
  const [header = '', ...lines] = body.split('\n');
  for (let index = 0; index + 1 < lines.length; index += 2) {
    if ((JSON.parse(lines[index] ?? '') as { type?: string }).type === 'event') {
      return {
        header: JSON.parse(header) as Record<string, unknown>,
        event: JSON.parse(lines[index + 1] ?? '') as SentEvent,
      };
    }
  }
  throw new Error('No event item in the envelope');
};

const apps = [
  { name: 'web', url: WEB_URL, dsn: DSNS.web, project: '1', key: 'e2e-web' },
  { name: 'admin', url: ADMIN_URL, dsn: DSNS.admin, project: '2', key: 'e2e-admin' },
] as const;

for (const app of apps) {
  test.describe(`${app.name} error tracking`, () => {
    test('sends a browser error to its own project through the relay, with no personal data', async ({
      page,
      request,
    }) => {
      const marker = `e2e-${app.name}-${Date.now()}`;

      await page.goto(`${app.url}/?token=secret-token`);
      const relayed = page.waitForResponse(
        (response) => new URL(response.url()).pathname === RELAY_PATH,
      );
      await page.evaluate((message) => {
        setTimeout(() => {
          throw new Error(message);
        });
      }, `${marker} ana@example.com`);

      const received = await waitForEnvelope(request, marker);
      expect(received.path).toBe(`/api/${app.project}/envelope/`);
      expect(new URLSearchParams(received.query).get('sentry_key')).toBe(app.key);
      for (const leaked of ['ana@example.com', 'secret-token', 'relay.invalid']) {
        expect(received.body).not.toContain(leaked);
      }

      const { header, event } = parseEnvelope(received.body);
      // The relay put the app's own DSN in place of the browser's placeholder.
      expect(header.dsn).toBe(app.dsn);
      expect(header).not.toHaveProperty('trace');
      expect(event.exception?.values?.[0]?.value).toBe(`${marker} [email]`);
      expect(event.release).toMatch(new RegExp(`^${app.name}@\\d+\\.\\d+\\.\\d+$`));
      expect(event.user).toBeUndefined();
      expect(event.request?.url).toBe(`${app.url}/`);
      expect(Object.keys(event.request?.headers ?? {})).toEqual(['User-Agent']);

      // GlitchTip's own headers (the fake sets a cookie) never reach the browser.
      const relayResponse = await relayed;
      expect(relayResponse.status()).toBe(200);
      expect(await relayResponse.headerValue('set-cookie')).toBeNull();
    });

    test('the relay accepts only small, well-formed envelopes', async ({ request }) => {
      const relay = `${app.url}${RELAY_PATH}`;

      expect((await request.get(relay)).status()).toBe(405);
      expect((await request.post(relay, { data: 'not an envelope' })).status()).toBe(400);
      const oversized = await request.post(relay, { data: `{}\n${'x'.repeat(300 * 1024)}` });
      expect(oversized.status()).toBe(413);
      expect(oversized.headers()['set-cookie']).toBeUndefined();
    });
  });
}
