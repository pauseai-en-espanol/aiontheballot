import type { CardImages, ComingSoonCard } from '@aiontheballot/og/coming-soon';
import type { ImageSize } from '@aiontheballot/og/image-size';
import type { ShareSize } from '@aiontheballot/og/sizes';

import { loadBrandImage } from './brand-images';
import { shareImages } from './image-cache';

/**
 * The home's share image, rendered once per content hash and process. The renderer (a native module) loads only
 * when an image is rendered, so if it ever failed to load, images would fail but pages would not.
 */
export const homeImage = (
  slug: string,
  locale: string,
  size: ShareSize,
  hash: string,
  card: ComingSoonCard,
): Promise<Uint8Array> =>
  shareImages()(`${slug}/${locale}/home/${size}/${hash}`, async () => {
    const [{ comingSoonCard }, { renderPng }, { imageSize }] = await Promise.all([
      import('@aiontheballot/og/coming-soon'),
      import('@aiontheballot/og/render'),
      import('@aiontheballot/og/image-size'),
    ]);
    return renderPng(comingSoonCard(card, size, await cardImages(slug, card, imageSize)), size);
  });

/** The largest side, in pixels, of a logo drawn on a card. */
const MAX_LOGO_SIDE = 4096;

/**
 * Whether a logo can go on a card: it is what it was declared as, and of a sane size. A tiny file can declare huge
 * dimensions, and the renderer would allocate for all of them (an image bomb).
 */
export const isDrawableLogo = (size: ImageSize | undefined, declared: string): size is ImageSize =>
  size !== undefined &&
  size.type === declared &&
  [size.width, size.height].every((side) => side >= 1 && side <= MAX_LOGO_SIDE);

/** The images a card names, as data URIs with their size; a logo that can't be read leaves the line in words. */
const cardImages = async (
  slug: string,
  card: ComingSoonCard,
  imageSize: (bytes: Uint8Array) => ImageSize | undefined,
): Promise<CardImages> => {
  if (!card.operatorLogo) {
    return {};
  }
  const bytes = await loadBrandImage(slug, card.operatorLogo.sha256);
  const size = imageSize(bytes);
  const sane = isDrawableLogo(size, card.operatorLogo.contentType);
  if (!sane) {
    return {};
  }
  const src = `data:${card.operatorLogo.contentType};base64,${Buffer.from(bytes).toString('base64')}`;
  return { operatorLogo: { src, width: size.width, height: size.height } };
};

/**
 * Renders it in the background, while the page that names it goes out: a crawler fetches the page, then the image,
 * which is then ready.
 */
export const warmHomeImage = (...args: Parameters<typeof homeImage>): void => {
  homeImage(...args).catch((error: unknown) => {
    console.error('Could not pre-render a share image', error);
  });
};

/**
 * Pre-renders every tenant's link preview, in each of its locales: run once a server has started, so whichever
 * replica a crawler reaches already has the images its pages name. Failures are logged; the route renders on demand.
 */
export const warmAllHomeImages = async (): Promise<void> => {
  const [
    { isLocale },
    { LINK_PREVIEW },
    { homeCardContent, homeCardHash },
    { loadRoutingTable, loadTenantPage },
  ] = await Promise.all([
    import('@aiontheballot/i18n/messages'),
    import('@aiontheballot/og/sizes'),
    import('./share'),
    import('./tenant-data'),
  ]);
  const table = await loadRoutingTable();
  for (const { slug, enabledLocales } of table?.tenantsBySlug.values() ?? []) {
    const page = await loadTenantPage(slug);
    if (page.kind !== 'found') {
      continue;
    }
    for (const locale of enabledLocales.filter(isLocale)) {
      const card = homeCardContent(page.home, locale, page.base);
      await homeImage(slug, locale, LINK_PREVIEW, homeCardHash(card, LINK_PREVIEW), card).catch(
        (error: unknown) => console.error('Could not pre-render a share image', error),
      );
    }
  }
};
