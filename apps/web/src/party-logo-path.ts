import type { BrandImage } from '@aiontheballot/domain/public-home';

import { isLogoSide, type LogoSide, SHRUNK_TYPES } from '@aiontheballot/og/logo-sides';

import { brandImagePath } from './brand-images';

/**
 * A party's logo at a side the site's boxes need (PLAN R236): `/brand/logo/{side}-{sha256}.png`, relative to the
 * tenant's root, redrawn small from the upload. A logo resvg can't draw (WebP) is named as uploaded.
 */
export const partyLogoPath = (logo: BrandImage, side: LogoSide): string | undefined =>
  SHRUNK_TYPES.has(logo.contentType)
    ? `/brand/logo/${side}-${logo.sha256}.png`
    : brandImagePath(logo);

export const parsePartyLogoFile = (
  file: string,
): { side: LogoSide; sha256: string } | undefined => {
  const [, side, sha256] = /^([1-9]\d{1,2})-([0-9a-f]{64})\.png$/.exec(file) ?? [];
  const number = Number(side);
  return sha256 && isLogoSide(number) ? { side: number, sha256 } : undefined;
};
