import { iconResponse } from '../../icons';

export const dynamic = 'force-static';

/** The tab icon the pages name (R154). */
export const GET = async (): Promise<Response> => {
  const { renderSiteIcon } = await import('@aiontheballot/og/site-icon-render');
  return iconResponse(renderSiteIcon({ kind: 'default' }, 32), 'image/png');
};
