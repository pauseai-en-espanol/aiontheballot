import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import { notFound } from 'next/navigation';

import { AuditView } from '@/audit/AuditView';
import { auditQuery, getAudit } from '@/audit/data';
import { getTenant, mayAct } from '@/data';
import { getLocale } from '@/locale';
import { requireStage } from '@/session';
import * as styles from '@/ui/styles';

type Params = {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const generateMetadata = async (): Promise<Metadata> => ({
  title: getTranslator(await getLocale())('admin.audit.title'),
});

/**
 * A site's audit log (editorial workflow H3): its country admins and platform admins read it; anyone else gets a 404,
 * and RLS would show them nothing anyway.
 */
const AuditPage = async ({ params, searchParams }: Params) => {
  await requireStage('signed-in');
  const { tenant: slug } = await params;
  const overview = await getTenant(slug);
  if (!overview || !mayAct(overview, 'country_admin')) {
    notFound();
  }
  const query = auditQuery(await searchParams);
  const path = `/t/${overview.tenant.slug}/audit`;
  const page = await getAudit(`/api${path}`, query);
  if (!page) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  return (
    <>
      <h1 className={styles.h1}>{t('admin.audit.title')}</h1>
      <p className={styles.text}>{t('admin.audit.intro')}</p>
      <AuditView page={page} query={query} path={path} locale={locale} withMembers />
    </>
  );
};

export default AuditPage;
