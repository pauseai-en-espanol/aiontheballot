import { buildRoutingTable } from '@aiontheballot/domain/routing';
import { describe, expect, it, vi } from 'vitest';

import { ANALYTICS_EVENT_PATH, ANALYTICS_SCRIPT_PATH } from './analytics-paths.js';
import {
  type Analytics,
  analyticsFrom,
  EVENT_MAX_BYTES,
  relayEvent,
  SCRIPT_RETRY_MS,
  SCRIPT_TTL_MS,
  type ScriptEntry,
  serveScript,
} from './analytics.js';

const HOST = 'sitio-de-ejemplo.test';
const UA = 'Mozilla/5.0 (Ejemplo)';
const analytics: Analytics = {
  url: 'http://plausible.test',
  sites: new Map([[HOST, 'pa-Ejemplo_1.js']]),
};

const post = (body: BodyInit, headers: Record<string, string> = {}, host = HOST) =>
  new Request(`http://internal:3000${ANALYTICS_EVENT_PATH}`, {
    method: 'POST',
    body,
    // Needed for a streamed body; the script's fetch has a length.
    duplex: 'half',
    headers: {
      host,
      'user-agent': UA,
      origin: `https://${host}`,
      'content-type': 'text/plain',
      cookie: '__Host-x=1',
      'x-forwarded-for': '203.0.113.7',
      ...headers,
    },
  } as RequestInit);

/** An event as the Plausible script sends it. */
const event = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({ n: 'pageview', v: 33, u: `https://${HOST}/`, d: HOST, r: null, ...fields });

const upstream = (response = () => new Response('{}', { status: 202 })) =>
  vi.fn<typeof fetch>(async () => {
    const answer = response();
    answer.headers.set('set-cookie', 'a=b');
    return answer;
  });

/** The one request the relay sent upstream. */
const sent = (send: ReturnType<typeof upstream>) => {
  expect(send).toHaveBeenCalledTimes(1);
  const [url, init] = send.mock.calls[0] ?? [];
  return {
    url,
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
    body: typeof init?.body === 'string' ? init.body : undefined,
    redirect: init?.redirect,
  };
};

/** Relays with logs collected rather than printed. */
const relay = (
  request: Request,
  send: typeof fetch,
  options: { analytics?: Analytics | undefined } = { analytics },
) => {
  const warn = vi.fn<(message: string) => void>();
  return {
    response: relayEvent(request, { analytics: options.analytics, fetch: send, warn }),
    warn,
  };
};

describe('analyticsFrom', () => {
  const site = (slug: string, plausibleScript: string | null) => ({
    id: `id-${slug}`,
    slug,
    defaultLocale: 'es',
    enabledLocales: ['es'],
    open: true,
    indexed: true,
    plausibleScript,
  });
  const table = buildRoutingTable([
    {
      tenant: site('sitio-a', 'pa-Ejemplo-a_1.js'),
      hostnames: [
        { hostname: 'sitio-a.example', isCanonical: true, verified: true },
        { hostname: 'alias-a.example', isCanonical: false, verified: true },
      ],
    },
    // A script but no canonical host (by path on the platform host): nowhere counted.
    { tenant: site('sitio-b', 'pa-b.js'), hostnames: [] },
    // A canonical host but no script.
    {
      tenant: site('sitio-c', null),
      hostnames: [{ hostname: 'sitio-c.example', isCanonical: true, verified: true }],
    },
  ]);
  const env = (url = 'http://plausible.plausible.svc.cluster.local') => ({ PLAUSIBLE_URL: url });

  it("counts each site with a script on its canonical host, and only there, from the deployment's upstream", () => {
    const warn = vi.fn();
    expect(analyticsFrom(env(), table, warn)).toEqual({
      url: 'http://plausible.plausible.svc.cluster.local',
      sites: new Map([['sitio-a.example', 'pa-Ejemplo-a_1.js']]),
    });
    expect(analyticsFrom(env('http://plausible.test/'), table, warn)?.url).toBe(
      'http://plausible.test',
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('counts nothing without an upstream or routing data, and says so when a site has a script', () => {
    const warn = vi.fn();
    expect(analyticsFrom(env(), undefined, warn)).toBeUndefined();
    expect(analyticsFrom({}, buildRoutingTable([]), warn)).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    expect(analyticsFrom({}, table, warn)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      'A site has a Plausible script but PLAUSIBLE_URL is not set: nothing is counted',
    );
    for (const url of ['not a url', 'file:///etc/passwd']) {
      expect(analyticsFrom(env(url), table, warn), url).toBeUndefined();
    }
    expect(warn).toHaveBeenCalledWith('PLAUSIBLE_URL is malformed: nothing is counted');
  });

  it("ignores a script that isn't one, whatever the data says", () => {
    const odd = buildRoutingTable([
      {
        tenant: site('sitio-d', '../admin.js'),
        hostnames: [{ hostname: 'sitio-d.example', isCanonical: true, verified: true }],
      },
    ]);
    expect(analyticsFrom(env(), odd)?.sites.size).toBe(0);
  });
});

describe('relayEvent', () => {
  it("forwards an event of this host's site, with only the browser and the visitor's address", async () => {
    const send = upstream();
    const body = event({ n: 'engagement', sd: 40, e: 5321, p: { autor: 'ejemplo' } });
    const { response, warn } = relay(post(body), send);

    expect((await response).status).toBe(202);
    expect((await response).headers.get('set-cookie')).toBeNull();
    expect((await response).headers.get('cache-control')).toBe('no-store');
    expect(sent(send)).toEqual({
      url: 'http://plausible.test/api/event',
      headers: { 'content-type': 'text/plain', 'user-agent': UA, 'x-forwarded-for': '203.0.113.7' },
      // The script writes its events with JSON.stringify, so written out again they are the same.
      body,
      redirect: 'error',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('forwards an event as this relay read it, so a repeated key means the same to Plausible', async () => {
    const send = upstream();
    // JSON.parse keeps the last of a repeated key; Plausible's parser keeps the first.
    const body = `{"n":"pageview","d":"otro.test","u":"https://otro.test/","d":"${HOST}","u":"https://${HOST}/"}`;
    expect((await relay(post(body), send).response).status).toBe(202);
    expect(sent(send).body).toBe(JSON.stringify({ n: 'pageview', d: HOST, u: `https://${HOST}/` }));
  });

  it('takes a host with a port, or with a trailing dot, by its name', async () => {
    for (const [host, url] of [
      [`${HOST}:4100`, `http://${HOST}:4100/en`],
      [`${HOST}.`, `https://${HOST}./`],
    ]) {
      const send = upstream();
      const body = event({ u: url });
      await relay(post(body, {}, host), send).response;
      expect(sent(send).body, host).toBe(body);
    }
  });

  it("takes the gateway's own entry, the last, as the address, and sends nothing without a visitor's", async () => {
    const cases: [string | undefined, string | undefined][] = [
      ['198.51.100.1, 203.0.113.9', '203.0.113.9'],
      ['2001:db8::1', '2001:db8::1'],
      ['::ffff:203.0.113.9', '203.0.113.9'],
      // What Next fills in when nothing set the header, and the cluster's, the VPN's and loopback addresses.
      ['127.0.0.1', undefined],
      ['::ffff:10.1.2.3', undefined],
      ['10.0.0.5', undefined],
      ['172.20.1.1', undefined],
      ['192.168.1.1', undefined],
      ['100.64.1.1', undefined],
      ['169.254.1.1', undefined],
      ['::1', undefined],
      ['fd00::1', undefined],
      ['fe80::1', undefined],
      // A private address written as IPv4-mapped hex, and forms the gateway never writes: IPv4-compatible, SIIT, NAT64.
      ['::ffff:a00:1', undefined],
      ['::10.0.0.1', undefined],
      ['::ffff:0:10.0.0.1', undefined],
      ['64:ff9b::a00:1', undefined],
      ['203.0.113.9, unknown', undefined],
      ['', undefined],
      [undefined, undefined],
    ];
    for (const [header, expected] of cases) {
      const send = upstream();
      const request = post(event());
      if (header === undefined) {
        request.headers.delete('x-forwarded-for');
      } else {
        request.headers.set('x-forwarded-for', header);
      }
      expect((await relay(request, send).response).status, header).toBe(202);
      if (expected === undefined) {
        expect(send, header).not.toHaveBeenCalled();
      } else {
        expect(sent(send).headers['x-forwarded-for'], header).toBe(expected);
      }
    }
  });

  it('reads the host as routing does: odd forms are no host', async () => {
    for (const host of [`x@${HOST}`, `${HOST.replace('e', '%65')}`]) {
      const send = upstream();
      expect((await relay(post(event(), {}, host), send).response).status, host).toBe(404);
      expect(send).not.toHaveBeenCalled();
    }
  });

  it('counts nothing for a host with no site, or with no configuration', async () => {
    for (const [request, config] of [
      [post(event({ d: 'otro.test', u: 'https://otro.test/' }), {}, 'otro.test'), analytics],
      [post(event()), undefined],
    ] as const) {
      const send = upstream();
      expect((await relay(request, send, { analytics: config }).response).status).toBe(404);
      expect(send).not.toHaveBeenCalled();
    }
  });

  it("refuses an event about another host's page, or one not written as the browser writes it, or nameless", async () => {
    for (const fields of [
      { u: 'https://otro.test/' },
      { u: `https://${HOST}.otro.test/` },
      { u: `https://${HOST}\\@otro.test/` },
      { u: `https://${HOST}/con espacio` },
      { u: `HTTPS://${HOST}/` },
      { u: 'javascript:alert(1)' },
      { u: '/relativa' },
      { u: undefined },
      { n: '' },
      { n: 7 },
      { n: undefined },
      { n: 'x'.repeat(121) },
    ]) {
      const send = upstream();
      const { response, warn } = relay(post(event(fields)), send);
      expect((await response).status, JSON.stringify(fields)).toBe(400);
      expect(send).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    }
  });

  it('refuses an event of another Plausible site, and says the site must be named after the host', async () => {
    for (const d of ['otro.test', undefined, `${HOST}.otro.test`]) {
      const send = upstream();
      const { response, warn } = relay(post(event({ d })), send);
      expect((await response).status, d).toBe(400);
      expect(send).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        `An event on ${HOST} named another Plausible site; if all do, name the site ${HOST}`,
      );
    }
  });

  it("refuses what isn't an event: no JSON, not an object, no browser, no host", async () => {
    const noBrowser = post(event());
    noBrowser.headers.delete('user-agent');
    const requests = [
      post('{'),
      post('null'),
      post(JSON.stringify([event()])),
      post(new Uint8Array([0xff, 0xfe])),
      noBrowser,
      post(event(), {}, ''),
    ];
    for (const [index, request] of requests.entries()) {
      const send = upstream();
      const { status } = await relay(request, send).response;
      expect(status, String(index)).toBeGreaterThanOrEqual(400);
      expect(status, String(index)).toBeLessThan(500);
      expect(send).not.toHaveBeenCalled();
    }
  });

  it("refuses a browser's event sent from another site, and takes one with no Origin (not a browser's)", async () => {
    for (const origin of ['https://otro.test', 'null', 'not a url']) {
      const send = upstream();
      expect((await relay(post(event(), { origin }), send).response).status, origin).toBe(403);
      expect(send).not.toHaveBeenCalled();
    }
    const send = upstream();
    const request = post(event());
    request.headers.delete('origin');
    expect((await relay(request, send).response).status).toBe(202);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('refuses a body over the limit, declared or not', async () => {
    const big = event({ u: `https://${HOST}/${'a'.repeat(EVENT_MAX_BYTES)}` });
    const streamed = post(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(big));
          controller.close();
        },
      }),
    );
    const declared = post(big, { 'content-length': String(big.length) });
    expect(declared.headers.get('content-length')).toBe(String(big.length));
    for (const request of [declared, streamed]) {
      const send = upstream();
      expect((await relay(request, send).response).status).toBe(413);
      expect(send).not.toHaveBeenCalled();
    }
  });

  it('answers 400 to an upload the browser gave up on', async () => {
    const send = upstream();
    const aborted = post(
      new ReadableStream({
        pull(controller) {
          controller.error(new Error('connection lost'));
        },
      }),
    );
    expect((await relay(aborted, send).response).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("frees Plausible's answer, and logs its failures with nothing of the visitor's, answering 202", async () => {
    let cancelled = false;
    const answer = upstream(
      () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { status: 202 },
        ),
    );
    const ok = relay(post(event()), answer);
    expect((await ok.response).status).toBe(202);
    expect(cancelled).toBe(true);
    expect(ok.warn).not.toHaveBeenCalled();

    const answering = (status: number) =>
      relay(
        post(event()),
        upstream(() => new Response('no', { status })),
      );
    // A 4xx is about the event, which anyone can make bad: not worth a line.
    const refusing = answering(400);
    const broken = answering(503);
    const busy = answering(429);
    const failing = relay(
      post(event()),
      vi.fn<typeof fetch>(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    for (const { response } of [refusing, broken, busy, failing]) {
      expect((await response).status).toBe(202);
    }
    expect(refusing.warn).not.toHaveBeenCalled();
    expect(broken.warn.mock.calls).toEqual([['Plausible answered 503 to an event']]);
    expect(busy.warn.mock.calls).toEqual([['Plausible answered 429 to an event']]);
    expect(failing.warn.mock.calls).toEqual([['Plausible did not answer an event']]);
  });
});

describe('serveScript', () => {
  const get = (host = HOST) =>
    new Request(`http://internal:3000${ANALYTICS_SCRIPT_PATH}`, { headers: { host } });
  const js = '/* el script de ejemplo */';

  /** Serves with a clock, a cache and logs of the test's own. */
  const setup = () => {
    const state = { clock: 0, cache: new Map<string, ScriptEntry>(), warn: vi.fn() };
    const serve = (send: typeof fetch, request = get()) =>
      serveScript(request, {
        analytics,
        cache: state.cache,
        now: () => state.clock,
        fetch: send,
        warn: state.warn,
      });
    return { state, serve };
  };

  it("serves this host's script from Plausible, and nothing of Plausible's response but the script", async () => {
    const { serve } = setup();
    const send = upstream(
      () =>
        new Response(js, { status: 200, headers: { 'content-type': 'application/javascript' } }),
    );
    const response = await serve(send, get(`${HOST}:4100`));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(js);
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBe('http://plausible.test/js/pa-Ejemplo_1.js');
    expect(send.mock.calls[0]?.[1]?.redirect).toBe('error');
  });

  it('keeps it five minutes, then asks again', async () => {
    const { state, serve } = setup();
    const ok = upstream(() => new Response(js, { status: 200 }));
    await serve(ok);
    state.clock = SCRIPT_TTL_MS - 1;
    await serve(ok);
    expect(ok).toHaveBeenCalledTimes(1);

    state.clock = SCRIPT_TTL_MS;
    const newer = upstream(() => new Response('/* nuevo */', { status: 200 }));
    expect(await (await serve(newer)).text()).toBe('/* nuevo */');
    expect(newer).toHaveBeenCalledTimes(1);
  });

  it('serves the last copy when Plausible fails, and leaves Plausible alone for a minute', async () => {
    const { state, serve } = setup();
    await serve(upstream(() => new Response(js, { status: 200 })));

    let cancelled = false;
    const refusing = upstream(
      () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { status: 502 },
        ),
    );
    state.clock = SCRIPT_TTL_MS;
    expect(await (await serve(refusing)).text()).toBe(js);
    expect(cancelled).toBe(true);
    expect(state.warn).toHaveBeenCalledWith(
      'Could not fetch pa-Ejemplo_1.js from Plausible: Error: Plausible answered 502',
    );

    const failing = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed');
    });
    state.clock = SCRIPT_TTL_MS + SCRIPT_RETRY_MS - 1;
    expect(await (await serve(failing)).text()).toBe(js);
    expect(failing).not.toHaveBeenCalled();

    state.clock = SCRIPT_TTL_MS + SCRIPT_RETRY_MS;
    expect(await (await serve(failing)).text()).toBe(js);
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('answers 503 with nothing to serve, without asking Plausible again for a minute', async () => {
    const { state, serve } = setup();
    const failing = upstream(() => new Response('caído', { status: 502 }));
    expect((await serve(failing)).status).toBe(503);
    state.clock = SCRIPT_RETRY_MS - 1;
    expect((await serve(failing)).status).toBe(503);
    expect(failing).toHaveBeenCalledTimes(1);
    state.clock = SCRIPT_RETRY_MS;
    const ok = upstream(() => new Response(js, { status: 200 }));
    expect((await serve(ok)).status).toBe(200);
  });

  it('asks again after a minute even when a fetch failed at once', async () => {
    const { state, serve } = setup();
    const throwing = vi.fn<typeof fetch>(() => {
      throw new TypeError('fetch failed');
    });
    expect((await serve(throwing)).status).toBe(503);
    state.clock = SCRIPT_RETRY_MS;
    const ok = upstream(() => new Response(js, { status: 200 }));
    expect((await serve(ok)).status).toBe(200);
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('asks Plausible once for requests that arrive together', async () => {
    const { serve } = setup();
    let answer: (response: Response) => void = () => undefined;
    const slow = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    const both = Promise.all([serve(slow), serve(slow)]);
    answer(new Response(js, { status: 200 }));
    const responses = await both;
    expect(slow).toHaveBeenCalledTimes(1);
    expect(await Promise.all(responses.map((response) => response.text()))).toEqual([js, js]);
  });

  it('answers 404 for a host with no site or with no configuration', async () => {
    const send = upstream(() => new Response(js, { status: 200 }));
    for (const [request, config] of [
      [get('otro.test'), analytics],
      [get(), undefined],
      [get(''), analytics],
    ] as const) {
      const response = await serveScript(request, {
        analytics: config,
        cache: new Map(),
        fetch: send,
      });
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(send).not.toHaveBeenCalled();
  });
});
