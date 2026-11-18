import { ADMIN_ICON_ART, iconResponse } from '../../icons';

export const dynamic = 'force-static';

/** The home-screen icon (R154), which iOS also asks for by this name. */
export const GET = async (): Promise<Response> => {
  const { renderSiteIcon } = await import('@aiontheballot/og/site-icon-render');
  return iconResponse(renderSiteIcon(ADMIN_ICON_ART, 180), 'image/png');
};
