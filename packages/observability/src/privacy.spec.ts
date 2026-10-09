import type { ErrorEvent } from '@sentry/core';

import { describe, expect, it } from 'vitest';

import { browserOptions, relayOptions } from './browser.js';
import {
  DATA_COLLECTION,
  privacyOptions,
  redactText,
  scrubBreadcrumb,
  scrubEvent,
} from './privacy.js';

describe('redactText', () => {
  it('redacts email addresses, including non-ASCII ones', () => {
    expect(redactText('Contacto: ana.garcia+prensa@example.com y josé@correo.example.es')).toBe(
      'Contacto: [email] y [email]',
    );
  });

  it('leaves package versions and releases alone', () => {
    expect(redactText('web@0.1.0 react-dom@19.3.0 npm:@sentry/core')).toBe(
      'web@0.1.0 react-dom@19.3.0 npm:@sentry/core',
    );
  });
});

const event = (overrides: Partial<ErrorEvent>): ErrorEvent => ({ type: undefined, ...overrides });

describe('scrubEvent', () => {
  it('drops the user and reduces the request to URL, method and user agent', () => {
    const scrubbed = scrubEvent(
      event({
        user: { id: 'u1', email: 'ana@example.com', ip_address: '203.0.113.7' },
        request: {
          url: 'https://admin.example.test/t/test-a/invite?token=secret#frag',
          method: 'POST',
          headers: {
            Cookie: '__Host-session=abc',
            'user-agent': 'Example/1.0',
            Referer: 'https://x.test/?q=1',
          },
          cookies: { session: 'abc' },
          data: { name: 'Ana', message: 'Texto libre' },
          query_string: 'token=secret',
        },
      }),
    );

    expect(scrubbed.user).toBeUndefined();
    expect(scrubbed.request).toEqual({
      url: 'https://admin.example.test/t/test-a/invite',
      method: 'POST',
      headers: { 'User-Agent': 'Example/1.0' },
    });
  });

  it('redacts email addresses anywhere in the event, keys included', () => {
    const scrubbed = scrubEvent(
      event({
        message: 'Failed for ana@example.com',
        exception: { values: [{ type: 'Error', value: 'Duplicate ana@example.com' }] },
        extra: { 'ana@example.com': { nested: ['ana@example.com'] } },
        tags: { contact: 'ana@example.com' },
      }),
    );

    expect(JSON.stringify(scrubbed)).not.toContain('ana@example.com');
    expect(scrubbed.message).toBe('Failed for [email]');
    expect(scrubbed.exception?.values?.[0]?.value).toBe('Duplicate [email]');
  });

  it('drops local variables from stack frames', () => {
    const scrubbed = scrubEvent(
      event({
        exception: {
          values: [
            {
              stacktrace: { frames: [{ function: 'submit', vars: { email: 'ana@example.com' } }] },
            },
          ],
        },
      }),
    );

    expect(scrubbed.exception?.values?.[0]?.stacktrace?.frames?.[0]).toEqual({
      function: 'submit',
    });
  });

  it('drops response headers and cookies', () => {
    const scrubbed = scrubEvent(
      event({
        contexts: {
          response: { status_code: 500, headers: { 'set-cookie': 'a=b' }, cookies: { a: 'b' } },
        },
      }),
    );

    expect(scrubbed.contexts?.response).toEqual({ status_code: 500 });
  });

  it('scrubs attached breadcrumbs and keeps SDK metadata untouched', () => {
    const metadata = { raw: { email: 'ana@example.com' } };
    const scrubbed = scrubEvent(
      event({
        breadcrumbs: [{ category: 'fetch', data: { url: '/api/x?email=ana@example.com' } }],
        sdkProcessingMetadata: metadata,
      }),
    );

    expect(scrubbed.breadcrumbs).toEqual([{ category: 'fetch', data: { url: '/api/x' } }]);
    expect(scrubbed.sdkProcessingMetadata).toBe(metadata);
  });

  it('does not mutate the original event', () => {
    const original = event({ user: { id: 'u1' }, message: 'ana@example.com' });
    scrubEvent(original);

    expect(original).toEqual(event({ user: { id: 'u1' }, message: 'ana@example.com' }));
  });
});

describe('scrubBreadcrumb', () => {
  it('strips queries from navigation and request URLs and redacts messages', () => {
    expect(
      scrubBreadcrumb({
        category: 'navigation',
        message: 'from ana@example.com',
        data: { from: '/a?token=1', to: '/b#x', url: 'https://x.test/c?d=e', status_code: 200 },
      }),
    ).toEqual({
      category: 'navigation',
      message: 'from [email]',
      data: { from: '/a', to: '/b', url: 'https://x.test/c', status_code: 200 },
    });
  });
});

describe('SDK options', () => {
  it('collects no personal data by default', () => {
    expect(DATA_COLLECTION).toMatchObject({
      userInfo: false,
      cookies: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    });
    expect(privacyOptions.beforeSend).toBe(scrubEvent);
    expect(privacyOptions.beforeBreadcrumb).toBe(scrubBreadcrumb);
  });

  it('sends browser events only through the relay, without sessions or tracing', () => {
    expect(relayOptions.tunnel).toBe('/_relay/errors');
    expect(relayOptions.beforeSend).toBe(scrubEvent);
    expect(browserOptions.tunnel).toBe('/_relay/errors');
    const names = ['GlobalHandlers', 'BrowserSession', 'BrowserTracing', 'Dedupe'];
    const kept = browserOptions.integrations(names.map((name) => ({ name })));

    expect(kept.map(({ name }) => name)).toEqual(['GlobalHandlers', 'Dedupe']);
  });
});
