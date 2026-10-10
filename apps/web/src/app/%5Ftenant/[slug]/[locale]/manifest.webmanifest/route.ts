import { pickLocalized } from '@aiontheballot/domain/localized';

import { plain } from '@/http-cache';
import { siteIconSource, webManifest } from '@/site-icon';
import { loadTenantPage } from '@/tenant-data';

interface ManifestContext {
  params: Promise<{ slug: string; locale: string }>;
}

/** The tenant's web manifest: its name, in its default language, and its icons for home screens. */
export const GET = async (_request: Request, { params }: ManifestContext): Promise<Response> => {
  const { slug } = await params;
  const page = await loadTenantPage(slug);
  if (page.kind === 'missing') {
    return plain(404, 'Not found');
  }
  if (page.kind === 'unavailable') {
    return plain(503, 'Service unavailable');
  }
  const { defaultLocale, displayName } = page.home.tenant;
  const name = pickLocalized(displayName, defaultLocale, defaultLocale) ?? '';
  const manifest = webManifest(name, defaultLocale, await siteIconSource(slug, page.home));
  return new Response(JSON.stringify(manifest), {
    headers: {
      'content-type': 'application/manifest+json; charset=utf-8',
      // Short: it names the icons by hash, and they change when the tenant's icon does.
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  });
};
