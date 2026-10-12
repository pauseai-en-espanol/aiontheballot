import { relayEvent } from '../../../analytics';
import { loadAnalytics } from '../../../tenant-data';

// The analytics event relay at /_relay/views (PLAN R83), beside the error relay. Only POST is exported, so any other
// method gets 405. Which site, if any, comes from the host and the site's settings (PLAN R135).
export const dynamic = 'force-dynamic';

export const POST = async (request: Request): Promise<Response> =>
  relayEvent(request, { analytics: await loadAnalytics() });
