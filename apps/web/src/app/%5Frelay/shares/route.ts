import { relayShare } from '../../../share-counts';
import { loadRoutingTable, routingConfig } from '../../../tenant-data';

// The share relay at /_relay/shares (PLAN R239), beside the error and analytics relays. Only POST is exported, so any
// other method gets 405. Which site and page come from the address the page sends, as the proxy resolves it.
export const dynamic = 'force-dynamic';

export const POST = async (request: Request): Promise<Response> =>
  relayShare(request, {
    table: await loadRoutingTable(),
    config: routingConfig,
    apiUrl: process.env.API_URL,
  });
