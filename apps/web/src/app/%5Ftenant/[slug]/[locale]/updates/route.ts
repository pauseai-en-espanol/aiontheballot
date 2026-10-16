import { isLocale } from '@aiontheballot/i18n/messages';

import { SIGNUP_ANCHOR } from '@/signup-outcomes';
import { handleSignupPost } from '@/signup-route';
import { pageHref, siteContext } from '@/site';
import { loadTenantPage } from '@/tenant-data';

interface Context {
  params: Promise<{ slug: string; locale: string }>;
}

/** The site's links this route answers with, on this host and in this locale; nothing for a tenant that isn't one. */
const linksFor = async ({ params }: Context) => {
  const { slug, locale } = await params;
  if (!isLocale(locale)) {
    return undefined;
  }
  const page = await loadTenantPage(slug);
  if (page.kind !== 'found') {
    return undefined;
  }
  const { root } = await siteContext();
  const href = (target: Parameters<typeof pageHref>[3]) =>
    pageHref(root, locale, page.tenant.defaultLocale, target);
  return {
    slug,
    locale,
    hrefs: {
      home: href({ page: 'home' }),
      confirm: href({ page: 'confirm' }),
      unsubscribe: href({ page: 'unsubscribe' }),
    },
  };
};

/** The signup list's form target (public-site spec §6): see handleSignupPost. */
export const POST = async (request: Request, context: Context): Promise<Response> => {
  const target = await linksFor(context);
  if (!target) {
    return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  return handleSignupPost(request, target, { apiUrl: process.env.API_URL });
};

/** Nothing to show here: back to the form. */
export const GET = async (_request: Request, context: Context): Promise<Response> => {
  const target = await linksFor(context);
  return new Response(null, {
    status: target ? 307 : 404,
    headers: {
      'cache-control': 'no-store',
      ...(target ? { location: `${target.hrefs.home}#${SIGNUP_ANCHOR}` } : {}),
    },
  });
};
