import type { PublicHome } from '@aiontheballot/domain/public-home';

import { siteIconHash } from '@aiontheballot/og/site-icon';
import { renderSiteIcon } from '@aiontheballot/og/site-icon-render';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  forgetSiteIconVerdicts,
  isSiteIconSettled,
  parseSiteIconFile,
  siteIconPath,
  siteIconSource,
  webManifest,
} from './site-icon';

const OTHER_MARK = { sha256: 'd'.repeat(64), contentType: 'image/png' };

/** A home whose other logo slots are all filled: none of them may stand in for the icon. */
const home = (brand: PublicHome['brand'] = {}): PublicHome => ({
  tenant: {
    displayName: { es: 'Inquilino de ejemplo' },
    defaultLocale: 'es',
    countryCode: 'XA',
    methodologyKind: 'demands',
  },
  operator: {
    displayName: { es: 'Organización de ejemplo' },
    url: null,
    contactEmail: null,
    newsletterUrl: null,
  },
  election: null,
  brand: {
    operator_logo_on_accent: OTHER_MARK,
    operator_logo_on_canvas: OTHER_MARK,
    operator_logo_on_inverse: OTHER_MARK,
    operator_mark: OTHER_MARK,
    ...brand,
  },
});

/** A whole 512 px PNG (the default icon), or one cut short, which a header check alone would take. */
const icon = (): Uint8Array => renderSiteIcon({ kind: 'default' }, 512);
const cutShort = (): Uint8Array => icon().slice(0, 200);

const SHA = 'c'.repeat(64);
const withIcon = (contentType = 'image/png') => home({ site_icon: { sha256: SHA, contentType } });

describe('the site icon a tenant gets', () => {
  beforeEach(() => {
    forgetSiteIconVerdicts();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it("is its own upload when that is a whole, square PNG of 512 to 1,024 px, read from the tenant's images", async () => {
    const load = vi.fn(async () => icon());
    expect(await siteIconSource('ejemplo', withIcon(), load)).toEqual({
      kind: 'tenant',
      sha256: SHA,
    });
    expect(load).toHaveBeenCalledWith('ejemplo', SHA);
  });

  it.each([
    ['without an upload, whatever its other logos', home(), async () => icon()],
    ['with an upload that is not a PNG', withIcon('image/jpeg'), async () => icon()],
    [
      'with a PNG that is too small',
      withIcon(),
      async () => renderSiteIcon({ kind: 'default' }, 180),
    ],
    ['with a PNG cut short', withIcon(), async () => cutShort()],
    [
      'while the upload cannot be read',
      withIcon(),
      async () => {
        throw new Error('API down');
      },
    ],
  ])('is the default %s, never another mark', async (_name, data, load) => {
    expect(await siteIconSource('ejemplo', data, load)).toEqual({ kind: 'default' });
  });

  it('decides once per upload: a page never downloads the icon again', async () => {
    const load = vi.fn(async () => icon());
    await siteIconSource('ejemplo', withIcon(), load);
    await siteIconSource('ejemplo', withIcon(), load);
    expect(load).toHaveBeenCalledTimes(1);
    const bad = vi.fn(async () => cutShort());
    const other = home({ site_icon: { sha256: 'e'.repeat(64), contentType: 'image/png' } });
    await siteIconSource('ejemplo', other, bad);
    expect(await siteIconSource('ejemplo', other, bad)).toEqual({ kind: 'default' });
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it('checks once when several pages ask at the same moment', async () => {
    const load = vi.fn(async () => icon());
    const answers = await Promise.all(
      [1, 2, 3].map(() => siteIconSource('ejemplo', withIcon(), load)),
    );
    expect(answers).toEqual(Array(3).fill({ kind: 'tenant', sha256: SHA }));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('is settled once checked, and only stands in while the upload cannot be read', async () => {
    expect(isSiteIconSettled(home())).toBe(true);
    expect(isSiteIconSettled(withIcon())).toBe(false);
    await siteIconSource('ejemplo', withIcon(), async () => {
      throw new Error('API down');
    });
    expect(isSiteIconSettled(withIcon())).toBe(false);
    forgetSiteIconVerdicts();
    await siteIconSource('ejemplo', withIcon(), async () => cutShort());
    expect(isSiteIconSettled(withIcon())).toBe(true);
  });

  it('asks again a minute after a failed read, not on every page', async () => {
    vi.useFakeTimers();
    try {
      const load = vi
        .fn<() => Promise<Uint8Array>>()
        .mockRejectedValueOnce(new Error('API down'))
        .mockResolvedValue(icon());
      expect(await siteIconSource('ejemplo', withIcon(), load)).toEqual({ kind: 'default' });
      expect(await siteIconSource('ejemplo', withIcon(), load)).toEqual({ kind: 'default' });
      expect(load).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(61_000);
      expect(await siteIconSource('ejemplo', withIcon(), load)).toEqual({
        kind: 'tenant',
        sha256: SHA,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('is served by size and content hash, which changes with the icon', () => {
    const path = siteIconPath({ kind: 'default' }, 32);
    expect(path).toBe(`/brand/icon/32.${siteIconHash({ kind: 'default' }, 32)}.png`);
    expect(parseSiteIconFile(path.split('/').pop() ?? '')).toEqual({
      size: 32,
      hash: siteIconHash({ kind: 'default' }, 32),
    });
    expect(siteIconPath({ kind: 'tenant', sha256: SHA }, 32)).not.toBe(path);
    for (const file of [
      '64.0123456789ab.png',
      '48.0123456789ab.png',
      '016.0123456789ab.png',
      '32.0123456789AB.png',
      '32.0123.png',
      '32.x.png',
    ]) {
      expect(parseSiteIconFile(file), file).toBeUndefined();
    }
  });

  it('is named in the web manifest, relative to it, at 192 and 512 px', () => {
    const manifest = webManifest('Inquilino de ejemplo', 'es', { kind: 'default' });
    expect(manifest).toMatchObject({ name: 'Inquilino de ejemplo', lang: 'es', start_url: './' });
    expect(manifest.icons).toEqual([
      expect.objectContaining({
        src: siteIconPath({ kind: 'default' }, 192).slice(1),
        sizes: '192x192',
      }),
      expect.objectContaining({
        src: siteIconPath({ kind: 'default' }, 512).slice(1),
        sizes: '512x512',
      }),
    ]);
  });
});
