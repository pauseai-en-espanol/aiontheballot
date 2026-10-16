import { isLocale } from '@aiontheballot/i18n/messages';

import { handleReportPost } from '@/report-route';
import { pageHref, siteContext } from '@/site';
import { loadTenantPage } from '@/tenant-data';

interface Context {
  params: Promise<{ slug: string; locale: string; election: string }>;
}

const notFound = () =>
  new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });

/**
 * Where the form is, on this host and in this locale; nothing where the site offers no form: a site coming soon (it
 * has no election pages), an election it doesn't list, a site without a published privacy policy, since a report may
 * hold personal data, or an API that takes no reports (their retention isn't enforced there).
 */
const targetFor = async ({ params }: Context) => {
  const { slug, locale, election } = await params;
  if (!isLocale(locale)) {
    return undefined;
  }
  const { root, mode } = await siteContext();
  if (mode === 'coming-soon') {
    return undefined;
  }
  const page = await loadTenantPage(slug);
  if (
    page.kind !== 'found' ||
    !page.home.elections.some((listed) => listed.slug === election) ||
    !page.home.documents.privacy_policy ||
    page.home.reports !== true
  ) {
    return undefined;
  }
  return {
    slug,
    election,
    formHref: pageHref(root, locale, page.tenant.defaultLocale, { page: 'report', election }),
  };
};

/** The right-of-reply form's target (PLAN R149): see handleReportPost. */
export const POST = async (request: Request, context: Context): Promise<Response> => {
  const target = await targetFor(context);
  return target ? handleReportPost(request, target, { apiUrl: process.env.API_URL }) : notFound();
};

/** Nothing to show here: back to the form. */
export const GET = async (_request: Request, context: Context): Promise<Response> => {
  const target = await targetFor(context);
  return target
    ? new Response(null, {
        status: 307,
        headers: { 'cache-control': 'no-store', location: target.formHref },
      })
    : notFound();
};
