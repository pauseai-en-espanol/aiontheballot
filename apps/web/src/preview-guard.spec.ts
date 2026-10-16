import { beforeAll, describe, expect, it, vi } from 'vitest';

const TOKEN = 'un-secreto-de-vista-previa-de-mas-de-32-caracteres';

let trustedSiteMode: typeof import('./preview-guard').trustedSiteMode;

beforeAll(async () => {
  // Read once per process, as the server reads it.
  vi.stubEnv('PREVIEW_TOKEN', TOKEN);
  ({ trustedSiteMode } = await import('./preview-guard'));
});

const headers =
  (values: Record<string, string>) =>
  (name: string): string | null =>
    values[name] ?? null;

describe('the site mode a page trusts (PLAN R181)', () => {
  it('is the preview only with the secret, else the mode that shows least', () => {
    const preview = { 'x-aiontheballot-site': 'preview' };
    expect(trustedSiteMode(headers({ ...preview, 'x-aiontheballot-preview-token': TOKEN }))).toBe(
      'preview',
    );
    for (const sent of [undefined, '', `${TOKEN}x`, TOKEN.slice(0, -1), TOKEN.toUpperCase()]) {
      expect(
        trustedSiteMode(
          headers(
            sent === undefined ? preview : { ...preview, 'x-aiontheballot-preview-token': sent },
          ),
        ),
      ).toBe('coming-soon');
    }
  });

  it('takes the other modes as the proxy set them', () => {
    expect(trustedSiteMode(headers({ 'x-aiontheballot-site': 'open' }))).toBe('open');
    expect(trustedSiteMode(headers({ 'x-aiontheballot-site': 'coming-soon' }))).toBe('coming-soon');
    expect(trustedSiteMode(headers({}))).toBe('coming-soon');
  });
});
