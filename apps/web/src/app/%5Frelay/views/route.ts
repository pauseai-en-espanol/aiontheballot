import { readAnalytics, relayEvent } from '../../../analytics';

// The analytics event relay at /_relay/views (PLAN R83), beside the error relay. Only POST is exported, so any other
// method gets 405.
export const dynamic = 'force-dynamic';

const analytics = readAnalytics(process.env);

export const POST = (request: Request): Promise<Response> => relayEvent(request, { analytics });
