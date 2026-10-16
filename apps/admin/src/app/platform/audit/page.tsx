import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import { notFound } from 'next/navigation';

import { AuditView } from '@/audit/AuditView';
import { auditQuery, getAudit } from '@/audit/data';
import { getLocale } from '@/locale';
import * as styles from '@/ui/styles';

type Params = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export const generateMetadata = async (): Promise<Metadata> => ({
  title: getTranslator(await getLocale())('admin.audit.platformTitle'),
});

/** The platform's own audit entries, no site's (editorial workflow H3.1): platform admins only. */
const PlatformAuditPage = async ({ searchParams }: Params) => {
  const query = auditQuery(await searchParams);
  const page = await getAudit('/api/platform/audit', query);
  if (!page) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  return (
    <>
      <h1 className={styles.h1}>{t('admin.audit.platformTitle')}</h1>
      <p className={styles.text}>{t('admin.audit.platformIntro')}</p>
      <AuditView
        page={page}
        query={query}
        path="/platform/audit"
        locale={locale}
        withMembers={false}
      />
    </>
  );
};

export default PlatformAuditPage;
