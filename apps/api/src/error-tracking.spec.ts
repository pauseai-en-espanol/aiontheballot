import { parseDsn } from '@aiontheballot/observability/dsn';
import { createTransport, type Envelope, parseEnvelope } from '@sentry/core';
import { flush } from '@sentry/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { initErrorTracking, readRelease } from './error-tracking.js';

const envelopes: Envelope[] = [];

const app = buildApp();
app.get('/fails', async () => {
  throw new Error('Fallo de ejemplo para ana@example.com');
});
app.get('/bad-request', async (_request, reply) => reply.code(400).send({ error: 'bad' }));

beforeAll(async () => {
  initErrorTracking(parseDsn('http://apikey@glitchtip.test/3'), {
    // Captures what would be sent to GlitchTip instead of sending it.
    transport: (options) =>
      createTransport(options, async (request) => {
        envelopes.push(parseEnvelope(request.body));
        return { statusCode: 200 };
      }),
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

const sentEvents = () =>
  envelopes.flatMap(([, items]) =>
    items.filter(([header]) => header.type === 'event').map(([, payload]) => payload),
  );

describe('error tracking', () => {
  it('reports a 5xx with no personal data', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/fails?token=secret',
      headers: {
        cookie: '__Host-session=abc',
        'user-agent': 'Example/1.0',
        'x-forwarded-for': '203.0.113.7',
      },
    });
    expect(response.statusCode).toBe(500);
    await flush(2000);

    const events = sentEvents();
    expect(events).toHaveLength(1);
    const serialized = JSON.stringify(events[0]);
    expect(serialized).toContain('Fallo de ejemplo para [email]');
    for (const leaked of ['ana@example.com', 'secret', '__Host-session', '203.0.113.7']) {
      expect(serialized).not.toContain(leaked);
    }
    expect(events[0]).toMatchObject({ release: readRelease() });
    expect(events[0]).not.toHaveProperty('user');
  });

  it('does not report client errors', async () => {
    const before = sentEvents().length;
    expect((await app.inject({ method: 'GET', url: '/bad-request' })).statusCode).toBe(400);
    await flush(2000);

    expect(sentEvents()).toHaveLength(before);
  });
});
