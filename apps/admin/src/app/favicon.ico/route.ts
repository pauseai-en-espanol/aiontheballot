import { ADMIN_ICON_ART, iconResponse } from '../../icons';

// Drawn once, at build time: the default icon depends on nothing but the code.
export const dynamic = 'force-static';

/** The 16, 32 and 48 px icons in one file (R154). */
export const GET = async (): Promise<Response> => {
  const { renderFavicon } = await import('@aiontheballot/og/site-icon-render');
  return iconResponse(renderFavicon(ADMIN_ICON_ART), 'image/x-icon');
};
