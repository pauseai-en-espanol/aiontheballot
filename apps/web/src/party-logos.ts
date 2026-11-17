import type { BrandImage } from '@aiontheballot/domain/public-home';

import { electionLoader } from './election-page';
import { createImageCache, type ImageCache } from './image-cache';
import { type SiteMode } from './site-mode';
import { type TenantPage } from './tenant-data';

/**
 * The logo with this hash of a party of one of the site's public elections (PLAN R142), or of one in preview for the
 * preview's mode: those elections' data is already kept by the web app, so a made-up hash costs no request to the API.
 */
export const partyLogoNamed = async (
  page: TenantPage,
  slug: string,
  sha256: string,
  mode: SiteMode,
): Promise<BrandImage | undefined> => {
  if (page.kind !== 'found') {
    return undefined;
  }
  for (const listed of page.home.elections) {
    const result = await electionLoader(mode)(slug, listed.slug);
    if (result.kind === 'found') {
      const logo = result.election.parties.find((party) => party.logo?.sha256 === sha256)?.logo;
      if (logo) {
        return logo;
      }
    }
  }
  return undefined;
};

const GLOBAL_KEY = Symbol.for('aiontheballot.smallPartyLogos');

/** Logos drawn small, by hash and side: each drawn once per process, as share images are. */
export const smallPartyLogos = (): ImageCache => {
  const store = globalThis as typeof globalThis & { [GLOBAL_KEY]?: ImageCache };
  // Two sides of a few dozen parties per election, at a few KB each.
  store[GLOBAL_KEY] ??= createImageCache({ maxEntries: 512, maxBytes: 16 * 1024 * 1024 });
  return store[GLOBAL_KEY];
};
