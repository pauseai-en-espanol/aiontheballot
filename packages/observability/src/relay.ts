import type { Dsn } from './dsn.js';

export interface RelayOptions {
  /** The app's own project. Without one (local development, CI), envelopes are accepted and dropped. */
  dsn: Dsn | undefined;
  /** Browser error envelopes are a few KB; attachments, replays and profiles are not used. */
  maxBytes?: number;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export const RELAY_MAX_BYTES = 200 * 1024;
const RELAY_TIMEOUT_MS = 5000;

// The SDK backs off when told to; nothing else from GlitchTip reaches the browser.
const FORWARDED_RESPONSE_HEADERS = ['retry-after', 'x-sentry-rate-limits'];

const reply = (status: number, headers: Record<string, string> = {}): Response =>
  new Response(null, { status, headers: { 'cache-control': 'no-store', ...headers } });

/** Reads the body up to `limit` bytes; undefined if it is larger. */
const readLimited = async (body: ReadableStream<Uint8Array> | null, limit: number) => {
  if (!body) {
    return new Uint8Array();
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The browser error relay (Sentry `tunnel`, ADR-0003 §7), mounted as a route handler in each Next app. It forwards
 * an envelope to the app's own GlitchTip project and nowhere else:
 *
 * - the upstream comes from server configuration, never from the request, so it can't be used to reach other hosts
 *   or projects;
 * - the envelope header's DSN is replaced with the configured one, and its tracing header is dropped;
 * - the body is capped, and no client header (cookies, client IP, referrer) is forwarded;
 * - the response sets no cookie and carries only GlitchTip's status and back-off headers.
 *
 * Items are forwarded as sent. PII scrubbing happens in the SDK (`beforeSend`) before anything leaves the browser.
 */
export const relayErrors = async (request: Request, options: RelayOptions): Promise<Response> => {
  const {
    dsn,
    maxBytes = RELAY_MAX_BYTES,
    timeoutMs = RELAY_TIMEOUT_MS,
    fetch: send = globalThis.fetch,
  } = options;
  if (!dsn) {
    return reply(204);
  }
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) {
    return reply(413);
  }
  const body = await readLimited(request.body, maxBytes);
  if (!body) {
    return reply(413);
  }

  const newline = body.indexOf(0x0a);
  const headerEnd = newline === -1 ? body.length : newline;
  let header: unknown;
  try {
    header = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(body.subarray(0, headerEnd)),
    );
  } catch {
    return reply(400);
  }
  if (!isRecord(header)) {
    return reply(400);
  }
  const { trace: _trace, ...kept } = header;
  const newHeader = new TextEncoder().encode(JSON.stringify({ ...kept, dsn: dsn.value }));
  const rest = body.subarray(headerEnd);
  const envelope = new Uint8Array(newHeader.length + rest.length);
  envelope.set(newHeader);
  envelope.set(rest, newHeader.length);

  let upstream: Response;
  try {
    upstream = await send(dsn.envelopeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-sentry-envelope' },
      body: envelope,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return reply(502);
  }
  await upstream.body?.cancel();
  const headers: Record<string, string> = {};
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) {
      headers[name] = value;
    }
  }
  return reply(upstream.status, headers);
};
