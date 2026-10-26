import type { Breadcrumb, DataCollection, Event, Options } from '@sentry/core';

/**
 * What the SDKs may collect: nothing about people (ADR-0003 §7). Sentry 11 collects cookies, headers, bodies, query
 * strings and local variables by default, so every category is off. The user agent is the one header kept, for
 * browser-specific bugs. Typed as `Required` so that a category added by a future SDK version fails the type check
 * until someone decides on it.
 */
export const DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: { allow: ['user-agent'] }, response: false },
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  frameContextLines: 5,
} satisfies Required<DataCollection>;

export const REDACTED_EMAIL = '[email]';

// The top-level domain must be letters, so versions such as `web@0.1.0` are left alone.
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;

export const redactText = (text: string): string => text.replace(EMAIL, REDACTED_EMAIL);

/**
 * Drops the query string and fragment. Tokens (invitations, password resets) must travel there, never in the path,
 * so they never reach an event.
 */
export const stripQuery = (url: string): string => url.split(/[?#]/, 1)[0] ?? url;

const MAX_DEPTH = 16;

const redactDeep = (value: unknown, depth = 0): unknown => {
  if (typeof value === 'string') {
    return redactText(value);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (depth >= MAX_DEPTH) {
    return '[truncated]';
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => redactDeep(item, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [redactText(key), redactDeep(item, depth + 1)]),
  );
};

const URL_KEYS = ['url', 'from', 'to'];

export const scrubBreadcrumb = (breadcrumb: Breadcrumb): Breadcrumb => {
  const scrubbed = redactDeep(breadcrumb) as Breadcrumb;
  const { data } = scrubbed;
  if (data) {
    for (const key of URL_KEYS) {
      const value: unknown = data[key];
      if (typeof value === 'string') {
        data[key] = stripQuery(value);
      }
    }
  }
  return scrubbed;
};

/** A field that may hold a URL or a path: its query string and fragment can carry a token. */
const URL_FIELD = /(?:url|path)$/i;

/** Strips the query and fragment from the URL- and path-like fields of an object, in place. */
const stripUrlFields = (fields: Record<string, unknown>): void => {
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'string' && URL_FIELD.test(key)) {
      fields[key] = stripQuery(value);
    }
  }
};

type EventRequest = NonNullable<Event['request']>;

/** Keeps the URL without its query, the method and the user agent. Bodies, cookies and other headers go. */
const scrubRequest = (request: EventRequest): EventRequest => {
  const userAgent = Object.entries(request.headers ?? {}).find(
    ([name]) => name.toLowerCase() === 'user-agent',
  );
  const scrubbed: EventRequest = {};
  if (request.url !== undefined) {
    scrubbed.url = stripQuery(request.url);
  }
  if (request.method !== undefined) {
    scrubbed.method = request.method;
  }
  if (userAgent) {
    scrubbed.headers = { 'User-Agent': userAgent[1] };
  }
  return scrubbed;
};

/**
 * The last line of defence before an event leaves the app (`beforeSend`): no user, request data reduced to URL,
 * method and user agent, no local variables, and email addresses redacted everywhere. Free text such as a report
 * message can't be recognised, so code must never put request bodies into errors; the data-collection options above
 * keep the SDKs from doing it.
 */
export const scrubEvent = <T extends Event>(event: T): T => {
  // SDK-internal bookkeeping, never sent; it holds live objects (scopes, the raw request) that mustn't be copied.
  const { sdkProcessingMetadata, ...sent } = event;
  const scrubbed = redactDeep(sent) as T;
  delete scrubbed.user;
  if (scrubbed.request) {
    scrubbed.request = scrubRequest(scrubbed.request);
  }
  if (scrubbed.breadcrumbs) {
    scrubbed.breadcrumbs = scrubbed.breadcrumbs.map(scrubBreadcrumb);
  }
  for (const exception of scrubbed.exception?.values ?? []) {
    for (const frame of exception.stacktrace?.frames ?? []) {
      delete frame.vars;
      // An inline script's frame names the page, query and fragment included.
      if (frame.filename !== undefined) {
        frame.filename = stripQuery(frame.filename);
      }
      if (frame.abs_path !== undefined) {
        frame.abs_path = stripQuery(frame.abs_path);
      }
    }
  }
  const response = scrubbed.contexts?.response;
  if (response) {
    delete response.headers;
    delete response.cookies;
  }
  // Contexts and tags the SDKs add, such as Next's request path (contexts.nextjs.request_path), which keeps the query.
  for (const context of Object.values(scrubbed.contexts ?? {})) {
    if (context) {
      stripUrlFields(context);
    }
  }
  if (scrubbed.tags) {
    stripUrlFields(scrubbed.tags);
  }
  if (scrubbed.transaction !== undefined) {
    scrubbed.transaction = stripQuery(scrubbed.transaction);
  }
  if (sdkProcessingMetadata !== undefined) {
    scrubbed.sdkProcessingMetadata = sdkProcessingMetadata;
  }
  return scrubbed;
};

/**
 * Privacy settings shared by every SDK: browser, Next server and the API. Errors only: no traces sample rate is set,
 * so no spans or transactions are ever sent.
 */
export const privacyOptions = {
  dataCollection: DATA_COLLECTION,
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
  // Outcome statistics: extra envelopes on every page hide, which GlitchTip doesn't use.
  sendClientReports: false,
} satisfies Pick<
  Options,
  'beforeBreadcrumb' | 'beforeSend' | 'dataCollection' | 'sendClientReports'
>;
