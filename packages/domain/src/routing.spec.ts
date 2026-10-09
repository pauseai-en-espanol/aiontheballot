import { describe, expect, it } from 'vitest';

import {
  buildRoutingTable,
  canonicalBase,
  normalizeHost,
  type Resolution,
  resolve,
  type RoutingConfig,
  type TenantHostname,
  type TenantRoute,
} from './routing.js';

// Fictional tenants on the reserved .test TLD.
const tenantA: TenantRoute = {
  id: 'a',
  slug: 'test-a',
  defaultLocale: 'es',
  enabledLocales: ['es', 'ca'],
};
const tenantB: TenantRoute = {
  id: 'b',
  slug: 'test-b',
  defaultLocale: 'es',
  enabledLocales: ['es'],
};
const tenantC: TenantRoute = {
  id: 'c',
  slug: 'test-c',
  defaultLocale: 'en',
  enabledLocales: ['en'],
};

const host = (hostname: string, verified = true, isCanonical = false): TenantHostname => ({
  hostname,
  isCanonical,
  verified,
});

const tenants = [
  {
    tenant: tenantA,
    hostnames: [
      host('ejemplo-a.test', true, true),
      host('alias-a.test'),
      host('xn--ejmplo-a-c1a.test'), // ejémplo-a.test
      host('pendiente-a.test', false),
    ],
  },
  // No canonical hostname: reachable as plataforma.test/test-b when a platform domain is configured.
  { tenant: tenantB, hostnames: [host('alias-b.test')] },
  // No hostnames at all.
  { tenant: tenantC, hostnames: [] },
];

const platform: RoutingConfig = { platformHost: 'plataforma.test' };
const table = buildRoutingTable(tenants, platform);

const request = (url: string, hostHeader?: string) => {
  const { host: urlHost, pathname, search } = new URL(`http://${url}`);
  return { host: hostHeader ?? urlHost, path: pathname, search };
};

const serve = (tenant: TenantRoute, locale: string, path: string): Resolution => ({
  kind: 'serve',
  tenant,
  locale,
  path,
  internalPath: `/_tenant/${tenant.slug}/${locale}${path === '/' ? '' : path}`,
});
const redirect = (location: string): Resolution => ({ kind: 'redirect', location });
const notFound: Resolution = { kind: 'not-found' };
const system: Resolution = { kind: 'system' };

describe('resolve', () => {
  it.each<[string, ReturnType<typeof request>, Resolution]>([
    // Hostnames
    ['unknown host', request('desconocido.test/'), notFound],
    ['unverified host', request('pendiente-a.test/'), notFound],
    ['no implicit www', request('www.ejemplo-a.test/'), notFound],
    [
      'canonical host',
      request('ejemplo-a.test/generales-2026'),
      serve(tenantA, 'es', '/generales-2026'),
    ],
    ['canonical root', request('ejemplo-a.test/'), serve(tenantA, 'es', '/')],
    [
      'mixed case, port, trailing dot',
      request('x/', 'EJEMPLO-A.test.:8443'),
      serve(tenantA, 'es', '/'),
    ],
    [
      'alias, same path and query',
      request('alias-a.test/generales-2026?vista=partidos'),
      redirect('https://ejemplo-a.test/generales-2026?vista=partidos'),
    ],
    [
      'IDN alias',
      request('x/generales-2026', 'ejémplo-a.test'),
      redirect('https://ejemplo-a.test/generales-2026'),
    ],
    [
      'the redirect never echoes the port',
      request('x/a', 'Alias-A.test:8080'),
      redirect('https://ejemplo-a.test/a'),
    ],
    [
      'alias of a tenant without a canonical host',
      request('alias-b.test/x?y=1'),
      redirect('https://plataforma.test/test-b/x?y=1'),
    ],
    // Platform domain
    [
      'platform path to a canonical host',
      request('plataforma.test/test-a/generales-2026?x=1'),
      redirect('https://ejemplo-a.test/generales-2026?x=1'),
    ],
    ['platform slug only', request('plataforma.test/test-a'), redirect('https://ejemplo-a.test/')],
    [
      'platform path served',
      request('plataforma.test/test-b/generales-2026'),
      serve(tenantB, 'es', '/generales-2026'),
    ],
    [
      'platform tenant with no hostnames',
      request('plataforma.test/test-c/'),
      serve(tenantC, 'en', '/'),
    ],
    ['platform unknown slug', request('plataforma.test/test-z/x'), notFound],
    ['platform root', request('plataforma.test/'), notFound],
    // Locales
    [
      'other locale prefix',
      request('ejemplo-a.test/ca/generales-2026'),
      serve(tenantA, 'ca', '/generales-2026'),
    ],
    ['other locale root', request('ejemplo-a.test/ca'), serve(tenantA, 'ca', '/')],
    [
      'default locale prefix redirects',
      request('ejemplo-a.test/es/generales-2026?x=1'),
      redirect('https://ejemplo-a.test/generales-2026?x=1'),
    ],
    [
      'default locale prefix on the platform',
      request('plataforma.test/test-b/es'),
      redirect('https://plataforma.test/test-b/'),
    ],
    [
      'a locale that is not enabled is just a path',
      request('ejemplo-a.test/en/x'),
      serve(tenantA, 'es', '/en/x'),
    ],
    // System and reserved paths
    ['build assets on any host', request('desconocido.test/_next/static/chunks/a.js'), system],
    ['health probe on a pod IP', request('x/healthz', '10.0.0.12:3000'), system],
    ['error relay', request('ejemplo-a.test/_relay/errors'), system],
    ['internal prefix', request('ejemplo-a.test/_tenant/test-b/es'), notFound],
    ['encoded internal prefix', request('ejemplo-a.test/%5ftenant/test-b/es'), notFound],
    ['any underscore path', request('ejemplo-a.test/_privado'), notFound],
    ['malformed encoding', request('ejemplo-a.test/%E0%A4%A'), notFound],
    ['encoded system path', request('ejemplo-a.test/%5Fnext/static/a.js'), notFound],
    // Malformed requests
    ['empty host', { host: '', path: '/', search: '' }, notFound],
    ['userinfo in the host', request('x/', 'otro.test@ejemplo-a.test'), notFound],
    ['percent-encoded host', request('x/', 'ejemplo%2Da.test'), notFound],
    ['bad port', request('x/', 'ejemplo-a.test:http'), notFound],
    ['relative path', { host: 'ejemplo-a.test', path: 'generales', search: '' }, notFound],
    [
      'raw line break in the path',
      { host: 'alias-a.test', path: '/x\r\nSet-Cookie: a=b', search: '' },
      notFound,
    ],
    ['raw space in the query', { host: 'alias-a.test', path: '/x', search: '?a b' }, notFound],
    ['query without ?', { host: 'alias-a.test', path: '/x', search: 'a=b' }, notFound],
  ])('%s', (_, input, expected) => {
    expect(resolve(input, table, platform)).toEqual(expected);
  });

  it('without a platform domain, the platform host is unknown and path-only tenants are unreachable', () => {
    const noPlatform = buildRoutingTable(tenants);

    expect(resolve(request('plataforma.test/test-b/x'), noPlatform)).toEqual(notFound);
    expect(resolve(request('alias-b.test/x'), noPlatform)).toEqual(notFound);
    expect(resolve(request('ejemplo-a.test/es/x'), noPlatform)).toEqual(
      redirect('https://ejemplo-a.test/x'),
    );
  });

  it('keeps percent-encoding as received in redirects', () => {
    expect(resolve(request('alias-a.test/a%20b?q=%C3%A9'), table, platform)).toEqual(
      redirect('https://ejemplo-a.test/a%20b?q=%C3%A9'),
    );
  });
});

describe('canonicalBase', () => {
  it('prefers the canonical hostname, then the platform path', () => {
    expect(canonicalBase(table, tenantA, platform)).toBe('https://ejemplo-a.test');
    expect(canonicalBase(table, tenantB, platform)).toBe('https://plataforma.test/test-b');
    expect(canonicalBase(table, tenantB)).toBeUndefined();
  });
});

describe('normalizeHost', () => {
  it.each([
    ['EJEMPLO-A.test', 'ejemplo-a.test'],
    ['ejemplo-a.test.', 'ejemplo-a.test'],
    ['ejemplo-a.test:8443', 'ejemplo-a.test'],
    ['ejémplo-a.test', 'xn--ejmplo-a-c1a.test'],
    ['[::1]:3000', '[::1]'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeHost(input)).toBe(expected);
  });

  it.each(['', '.', 'a b', 'a/b', 'a@b.test', 'a%2Eb.test', 'a.test:99999'])(
    'rejects %j',
    (input) => {
      expect(normalizeHost(input)).toBeUndefined();
    },
  );
});

describe('buildRoutingTable', () => {
  it.each<[string, Parameters<typeof buildRoutingTable>[0]]>([
    [
      'a duplicate hostname',
      [
        { tenant: tenantA, hostnames: [host('compartido.test')] },
        { tenant: tenantB, hostnames: [host('compartido.test')] },
      ],
    ],
    [
      'a second canonical hostname',
      [
        {
          tenant: tenantA,
          hostnames: [host('uno.test', true, true), host('dos.test', true, true)],
        },
      ],
    ],
    [
      'an unverified canonical hostname',
      [{ tenant: tenantA, hostnames: [host('uno.test', false, true)] }],
    ],
    ['a hostname that is not normalized', [{ tenant: tenantA, hostnames: [host('Uno.test')] }]],
    ['a hostname with a trailing dot', [{ tenant: tenantA, hostnames: [host('uno.test.')] }]],
    ['the platform host', [{ tenant: tenantA, hostnames: [host('plataforma.test')] }]],
    [
      'a duplicate slug',
      [
        { tenant: tenantA, hostnames: [] },
        { tenant: { ...tenantB, slug: 'test-a' }, hostnames: [] },
      ],
    ],
    [
      'a default locale that is not enabled',
      [{ tenant: { ...tenantA, enabledLocales: ['ca'] }, hostnames: [] }],
    ],
  ])('rejects %s', (_, input) => {
    expect(() => buildRoutingTable(input, platform)).toThrow();
  });
});
