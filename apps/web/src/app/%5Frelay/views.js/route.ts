import { type ScriptEntry, serveScript } from '../../../analytics';
import { loadAnalytics } from '../../../tenant-data';

// The tenant's Plausible script at /_relay/views.js (PLAN R83), fetched from Plausible inside the cluster and kept a
// few minutes per process. Which site's script, if any, comes from the host and the site's settings (PLAN R135).
export const dynamic = 'force-dynamic';

const cache = new Map<string, ScriptEntry>();

export const GET = async (request: Request): Promise<Response> =>
  serveScript(request, { analytics: await loadAnalytics(), cache });
