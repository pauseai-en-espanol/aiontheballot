import type { IncomingMessage } from 'node:http';

import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { addAbortSignal, pipeline, type Readable, type Transform } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

import { isPublicAddress } from './address.js';

/**
 * Fetching a member's URL (ADR-0007 §2), as the fetcher alone does: the public internet only, at most a copy's size,
 * within a deadline, following a few redirects, each checked as the first URL was. Nothing of the member's goes with
 * it: no cookie, no referrer, only the URL's own request.
 */

/** Why a URL gave no copy: the member's to hear, never an error report. */
export type FetchFailure =
  /** Not http or https, a user name or password in it, or a port other than 80 or 443. */
  | 'scheme'
  /** A name that resolves to an address off the public internet, or to none. */
  | 'address'
  /** More redirects than allowed, or one that leads nowhere. */
  | 'redirects'
  /** The site answered with an error (its status in `status`). */
  | 'status'
  /** No answer: the name doesn't resolve, the connection failed, TLS failed. */
  | 'unreachable'
  /** Past the deadline. */
  | 'timeout'
  /** More than a copy may be. */
  | 'tooLarge';

export class FetchRefused extends Error {
  readonly reason: FetchFailure;
  readonly status: number | undefined;

  constructor(reason: FetchFailure, status?: number) {
    super(`The URL gave no copy: ${reason}${status === undefined ? '' : ` ${status}`}`);
    this.name = 'FetchRefused';
    this.reason = reason;
    this.status = status;
  }
}

export interface Fetched {
  /** The type the site declared, lowercase and without parameters; undefined when it declared none. */
  contentType: string | undefined;
  /** The address the bytes came from, after redirects. */
  finalUrl: string;
  bytes: Buffer;
}

export interface FetchOptions {
  /** The largest copy (the files table's limit). */
  maxBytes: number;
  /** For the whole fetch, redirects included. */
  deadlineMs: number;
  /** How the fetcher names itself to sites (configuration, never a product name in code). */
  userAgent: string;
  maxRedirects?: number;
  /** Which resolved addresses may be connected to: the public internet, unless a test says otherwise. */
  isAllowedAddress?: (address: string) => boolean;
  /** Which ports a URL may name (`''` is the scheme's own): 80 and 443, unless a test says otherwise. */
  ports?: ReadonlySet<string>;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const PORTS: ReadonlySet<string> = new Set(['', '80', '443']);

/** A URL the fetcher may ask for, parsed; anything else is refused before a connection. */
export const fetchableUrl = (value: string, base?: URL, ports = PORTS): URL => {
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    throw new FetchRefused(base ? 'redirects' : 'scheme');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== '' ||
    !ports.has(url.port)
  ) {
    throw new FetchRefused('scheme');
  }
  return url;
};

/**
 * The lookup every connection uses: all of the name's addresses must be allowed, or none is used, so the address
 * checked is the one connected to (no rebinding between a check and the connection).
 */
const checkedLookup =
  (isAllowed: (address: string) => boolean): LookupFunction =>
  (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (error, found: LookupAddress[]) => {
      if (error) {
        callback(error, '', 4);
        return;
      }
      if (found.length === 0 || found.some(({ address }) => !isAllowed(address))) {
        callback(
          Object.assign(new Error('The name resolves off the public internet'), {
            code: 'ENOTPUBLIC',
          }),
          '',
          4,
        );
        return;
      }
      if (options.all) {
        (callback as unknown as (error: null, addresses: LookupAddress[]) => void)(null, found);
        return;
      }
      const [first] = found;
      callback(null, first?.address ?? '', first?.family ?? 4);
    });
  };

/** The decoder for a compressed response, if the site compressed it. */
const decoderFor = (encoding: string | undefined): Transform | undefined => {
  switch ((encoding ?? '').trim().toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return createGunzip();
    case 'deflate':
      return createInflate();
    case 'br':
      return createBrotliDecompress();
    default:
      return undefined;
  }
};

/**
 * The response's body as sent, decoded if the site compressed it anyway, and destroyed at the deadline. Through
 * `pipeline`, never `pipe`: a response that stalls or is cut off mid-body ends its decoder with it, so reading it
 * fails rather than waiting for ever.
 */
const decoded = (response: IncomingMessage, signal: AbortSignal): Readable => {
  const decoder = decoderFor(response.headers['content-encoding']);
  const body = decoder ? pipeline(response, decoder, () => undefined) : response;
  return addAbortSignal(signal, body);
};

const bareType = (header: string | undefined): string | undefined => {
  const type = header?.split(';')[0]?.trim().toLowerCase();
  return type ? type : undefined;
};

/** One request, no redirect followed: the response, or a refusal. */
const get = (
  url: URL,
  { userAgent, lookup, signal }: { userAgent: string; lookup: LookupFunction; signal: AbortSignal },
): Promise<IncomingMessage> =>
  new Promise((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = send(
      url,
      {
        method: 'GET',
        lookup,
        signal,
        headers: {
          'user-agent': userAgent,
          accept: 'application/pdf, text/html;q=0.9, text/plain;q=0.8, image/*;q=0.7, */*;q=0.5',
          'accept-encoding': 'gzip, deflate, br',
        },
      },
      resolve,
    );
    request.on('error', (error: NodeJS.ErrnoException) => {
      if (signal.aborted) {
        reject(new FetchRefused('timeout'));
      } else if (error.code === 'ENOTPUBLIC') {
        reject(new FetchRefused('address'));
      } else {
        reject(new FetchRefused('unreachable'));
      }
    });
    request.end();
  });

/** The body, at most `maxBytes` of it once decoded, before the deadline. */
const readCapped = async (
  response: IncomingMessage,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Buffer> => {
  const declared = Number(response.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    response.destroy();
    throw new FetchRefused('tooLarge');
  }
  const body = decoded(response, signal);
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of body) {
      size += (chunk as Buffer).byteLength;
      if (size > maxBytes) {
        throw new FetchRefused('tooLarge');
      }
      chunks.push(chunk as Buffer);
    }
  } catch (error) {
    if (error instanceof FetchRefused) {
      throw error;
    }
    throw new FetchRefused(signal.aborted ? 'timeout' : 'unreachable');
  } finally {
    response.destroy();
    body.destroy();
  }
  return Buffer.concat(chunks);
};

/** Fetches a member's URL, or refuses with why (fetchUrl, below, bounds it in time). */
const fetchWithin = async (value: string, options: FetchOptions): Promise<Fetched> => {
  const {
    maxBytes,
    deadlineMs,
    userAgent,
    maxRedirects = 5,
    isAllowedAddress = isPublicAddress,
    ports = PORTS,
  } = options;
  const signal = AbortSignal.timeout(deadlineMs);
  const lookup = checkedLookup(isAllowedAddress);
  let url = fetchableUrl(value, undefined, ports);
  for (let redirects = 0; ; redirects += 1) {
    // An address written in the URL is connected to without a lookup: checked here instead.
    const literal = url.hostname.replace(/^\[(.*)\]$/u, '$1');
    if (isIP(literal) !== 0 && !isAllowedAddress(literal)) {
      throw new FetchRefused('address');
    }
    const response = await get(url, { userAgent, lookup, signal });
    const status = response.statusCode ?? 0;
    if (REDIRECTS.has(status)) {
      response.destroy();
      const location = response.headers.location;
      if (!location || redirects >= maxRedirects) {
        throw new FetchRefused('redirects');
      }
      url = fetchableUrl(location, url, ports);
      continue;
    }
    if (status < 200 || status >= 300) {
      response.destroy();
      throw new FetchRefused('status', status);
    }
    const bytes = await readCapped(response, maxBytes, signal);
    return { contentType: bareType(response.headers['content-type']), finalUrl: url.href, bytes };
  }
};

/** How long past its deadline a fetch is given up whatever it waits for: a backstop, never the rule. */
const BACKSTOP_MS = 1_000;

/**
 * Fetches a member's URL as ADR-0007 §2 says, or refuses with why; never later than shortly after its deadline, which
 * aborts the request and its body, and, should anything still wait, gives up on it.
 */
export const fetchUrl = (value: string, options: FetchOptions): Promise<Fetched> => {
  let timer: NodeJS.Timeout | undefined;
  const backstop = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new FetchRefused('timeout')), options.deadlineMs + BACKSTOP_MS);
  });
  return Promise.race([fetchWithin(value, options), backstop]).finally(() => clearTimeout(timer));
};

/** The magic numbers of the types a copy may have that sites often serve as `application/octet-stream`. */
const SNIFFED: readonly [string, readonly number[], number][] = [
  ['application/pdf', [0x25, 0x50, 0x44, 0x46, 0x2d], 0], // %PDF-
  ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0],
  ['image/jpeg', [0xff, 0xd8, 0xff], 0],
  ['image/webp', [0x57, 0x45, 0x42, 0x50], 8], // RIFF....WEBP
];

/** Types that say nothing about what the bytes are. */
const UNDECLARED = new Set([undefined, 'application/octet-stream', 'binary/octet-stream']);

/**
 * The type a fetched copy is stored as: the one the site declared, or, when it declared none or only "bytes", the
 * one its first bytes show (a PDF or an image), else none. XHTML is a web page.
 */
export const copyType = (declared: string | undefined, bytes: Uint8Array): string | undefined => {
  if (declared === 'application/xhtml+xml') {
    return 'text/html';
  }
  if (!UNDECLARED.has(declared)) {
    return declared;
  }
  const found = SNIFFED.find(([, magic, offset]) =>
    magic.every((byte, index) => bytes[offset + index] === byte),
  );
  return found?.[0];
};
