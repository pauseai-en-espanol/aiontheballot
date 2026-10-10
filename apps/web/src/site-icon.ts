import { BRAND_SLOTS, type PublicHome } from '@aiontheballot/domain/public-home';
import {
  DEFAULT_SITE_ICON,
  isServedSiteIconSize,
  isUsableSiteIcon,
  type ServedSiteIconSize,
  SITE_ICON_COLOURS,
  siteIconHash,
  type SiteIconSize,
  type SiteIconSource,
} from '@aiontheballot/og/site-icon';

import { loadBrandImage } from './brand-images';
import { createImageCache, type ImageCache } from './image-cache';

type LoadBytes = (slug: string, sha256: string) => Promise<Uint8Array>;

/**
 * What is known about each upload, by its SHA-256: whether it is a usable icon (the answer depends only on the bytes,
 * so it never goes stale, and pages never download the icon again to decide), a check under way (so pages asking at
 * once share it), or that it couldn't be read, and until when that counts. One per process: Next bundles the pages,
 * the routes and the startup hook separately, so module state would be one per bundle and the warm-up would warm
 * nothing the pages read.
 */
interface IconChecks {
  verdicts: Map<string, boolean>;
  pending: Map<string, Promise<boolean>>;
  failures: Map<string, number>;
}

const CHECKS_KEY = Symbol.for('aiontheballot.siteIconChecks');
const checks = (): IconChecks => {
  const store = globalThis as typeof globalThis & { [CHECKS_KEY]?: IconChecks };
  store[CHECKS_KEY] ??= { verdicts: new Map(), pending: new Map(), failures: new Map() };
  return store[CHECKS_KEY];
};

const MAX_VERDICTS = 256;
const RETRY_AFTER_MS = 60_000;

const remember = ({ verdicts }: IconChecks, sha256: string, usable: boolean) => {
  verdicts.set(sha256, usable);
  for (const oldest of verdicts.keys()) {
    if (verdicts.size <= MAX_VERDICTS) {
      break;
    }
    verdicts.delete(oldest);
  }
};

const failed = ({ failures }: IconChecks, sha256: string) => {
  const now = Date.now();
  for (const [key, until] of failures) {
    if (until <= now) {
      failures.delete(key);
    }
  }
  failures.set(sha256, now + RETRY_AFTER_MS);
};

/**
 * Which icon a tenant's pages use: its `site_icon` upload if that is a whole PNG, square, 512 to 1,024 px a side, and
 * otherwise the platform's default, also while the upload can't be read. Never another organization's mark.
 */
export const siteIconSource = async (
  slug: string,
  home: PublicHome,
  load: LoadBytes = loadBrandImage,
): Promise<SiteIconSource> => {
  const image = home.brand[BRAND_SLOTS.siteIcon];
  if (image?.contentType !== 'image/png') {
    return DEFAULT_SITE_ICON;
  }
  const tenant: SiteIconSource = { kind: 'tenant', sha256: image.sha256 };
  const state = checks();
  const known = state.verdicts.get(image.sha256);
  if (known !== undefined) {
    return known ? tenant : DEFAULT_SITE_ICON;
  }
  if ((state.failures.get(image.sha256) ?? 0) > Date.now()) {
    return DEFAULT_SITE_ICON;
  }
  let pending = state.pending.get(image.sha256);
  if (!pending) {
    pending = load(slug, image.sha256).then((bytes) => isUsableSiteIcon(bytes));
    state.pending.set(image.sha256, pending);
    pending
      .then((usable) => remember(state, image.sha256, usable))
      .catch((error: unknown) => {
        failed(state, image.sha256);
        console.error(`Could not read the site icon of ${slug}; using the default for now`, error);
      })
      .finally(() => state.pending.delete(image.sha256));
  }
  try {
    return (await pending) ? tenant : DEFAULT_SITE_ICON;
  } catch {
    return DEFAULT_SITE_ICON;
  }
};

/**
 * Whether the icon a tenant gets is settled: it has none, or its upload has been checked. While its upload can't be
 * read, the default stands in only for now, and nothing should keep it for long.
 */
export const isSiteIconSettled = (home: PublicHome): boolean => {
  const image = home.brand[BRAND_SLOTS.siteIcon];
  return image?.contentType !== 'image/png' || checks().verdicts.has(image.sha256);
};

/** Forgets every verdict and failure: for tests. */
export const forgetSiteIconVerdicts = (): void => {
  const state = checks();
  state.verdicts.clear();
  state.pending.clear();
  state.failures.clear();
};

/** `/brand/icon/{size}.{hash}.png`, relative to the tenant's root: the same in every locale. */
export const siteIconPath = (source: SiteIconSource, size: ServedSiteIconSize): string =>
  `/brand/icon/${size}.${siteIconHash(source, size)}.png`;

export const parseSiteIconFile = (
  file: string,
): { size: ServedSiteIconSize; hash: string } | undefined => {
  const [, size, hash] = /^([1-9]\d{1,2})\.([0-9a-f]{12})\.png$/.exec(file) ?? [];
  const side = Number(size);
  return hash && isServedSiteIconSize(side) ? { size: side, hash } : undefined;
};

/** Rendered icons by content hash, apart from the share images: most are a few kilobytes, a busy one at 512 px more. */
const GLOBAL_KEY = Symbol.for('aiontheballot.siteIcons');
const siteIcons = (): ImageCache => {
  const store = globalThis as typeof globalThis & { [GLOBAL_KEY]?: ImageCache };
  store[GLOBAL_KEY] ??= createImageCache({ maxEntries: 512 });
  return store[GLOBAL_KEY];
};

/**
 * The renderer (a native module) loads only when an icon is drawn, as for share images, so pages never depend on it.
 * An icon is drawn again only if the cache has let it go: its hash covers everything it is drawn from.
 */
const art = async (slug: string, source: SiteIconSource, load: LoadBytes) =>
  source.kind === 'default'
    ? ({ kind: 'default' } as const)
    : ({ kind: 'tenant', png: await load(slug, source.sha256) } as const);

export const siteIconPng = (
  slug: string,
  source: SiteIconSource,
  size: SiteIconSize,
  load: LoadBytes = loadBrandImage,
): Promise<Uint8Array> =>
  siteIcons()(`icon/${siteIconHash(source, size)}`, async () => {
    const { renderSiteIcon } = await import('@aiontheballot/og/site-icon-render');
    return renderSiteIcon(await art(slug, source, load), size);
  });

export const faviconIco = (
  slug: string,
  source: SiteIconSource,
  load: LoadBytes = loadBrandImage,
): Promise<Uint8Array> =>
  siteIcons()(`favicon/${siteIconHash(source, 'ico')}`, async () => {
    const { renderFavicon } = await import('@aiontheballot/og/site-icon-render');
    return renderFavicon(await art(slug, source, load));
  });

/**
 * The web manifest, at the tenant's root: its name and its icons, whose relative addresses resolve against the
 * manifest's own, on a tenant's hostname or under its path on the platform host alike.
 */
export const webManifest = (name: string, lang: string, source: SiteIconSource) => ({
  name,
  lang,
  start_url: './',
  scope: './',
  display: 'browser',
  background_color: SITE_ICON_COLOURS.background,
  theme_color: SITE_ICON_COLOURS.theme,
  icons: ([192, 512] as const).map((size) => ({
    src: siteIconPath(source, size).slice(1),
    sizes: `${size}x${size}`,
    type: 'image/png',
  })),
});
