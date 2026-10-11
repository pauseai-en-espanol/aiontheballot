import { readAnalytics, type ScriptEntry, serveScript } from '../../../analytics';

// The tenant's Plausible script at /_relay/views.js (PLAN R83), fetched from Plausible inside the cluster and kept a
// few minutes per process.
export const dynamic = 'force-dynamic';

const analytics = readAnalytics(process.env);
const cache = new Map<string, ScriptEntry>();

export const GET = (request: Request): Promise<Response> =>
  serveScript(request, { analytics, cache });
