import { loadElection } from '@/election-page';
import { processWide } from '@/process-wide';
import { createCoalescer, handleRevalidate } from '@/revalidate';
import { loadHome, loadRoutingTable } from '@/tenant-data';

const coalesce = processWide('revalidations', createCoalescer);

/** The API's word that a site's public data changed (R151): see handleRevalidate. */
export const POST = (request: Request): Promise<Response> =>
  handleRevalidate(
    request,
    {
      routing: async (tenant) =>
        (await loadRoutingTable({ force: true }))?.tenantsBySlug.has(tenant) ?? false,
      home: async (tenant) => {
        const home = await loadHome(tenant, { force: true });
        return home.kind === 'found'
          ? { elections: home.home.elections.map((election) => election.slug) }
          : undefined;
      },
      // Only an election the site lists reaches the API, as everywhere (an unknown slug costs nothing).
      election: async (tenant, election) => {
        const home = await loadHome(tenant);
        if (
          home.kind === 'found' &&
          home.home.elections.some((listed) => listed.slug === election)
        ) {
          await loadElection(tenant, election, { force: true });
        }
      },
    },
    coalesce,
  );
