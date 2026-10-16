import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getTenant } from '@/data';
import { getLocale } from '@/locale';
import { inLanguage, siteName } from '@/localized';
import { getReports, REPORT_STATUSES, type ReportStatus } from '@/reports/data';
import { requireStage } from '@/session';
import { Lang } from '@/ui/Lang';
import * as styles from '@/ui/styles';

type Params = {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ status?: string }>;
};

export const generateMetadata = async ({ params }: Params): Promise<Metadata> => {
  const overview = await getTenant((await params).tenant);
  const locale = await getLocale();
  const t = getTranslator(locale);
  return {
    title: overview
      ? `${t('admin.reports.title')} · ${siteName(overview.tenant, locale).text}`
      : t('admin.notFound.title'),
  };
};

/**
 * The right-of-reply queue (editorial workflow H2, screen 13): the site's reports, new ones first, filtered by status,
 * each with what it is about. Members read them; platform admins see none (PLAN P11), and the page says why.
 */
const ReportsPage = async ({ params, searchParams }: Params) => {
  await requireStage('signed-in');
  const { tenant: slug } = await params;
  const wanted = (await searchParams).status;
  const status = REPORT_STATUSES.find((candidate) => candidate === wanted);
  const [overview, list] = await Promise.all([getTenant(slug), getReports(slug, status)]);
  if (!overview || !list) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  const { tenant } = overview;
  const base = `/t/${tenant.slug}/reports`;
  const total = Object.values(list.counts).reduce((sum, count) => sum + count, 0);
  const label = (value: ReportStatus) => t(`admin.reports.statuses.${value}`);
  const filters: { href: string; text: string; current: boolean }[] = [
    { href: base, text: t('admin.reports.all', { count: total }), current: status === undefined },
    ...REPORT_STATUSES.map((value) => ({
      href: `${base}?status=${value}`,
      text: t('admin.reports.statusCount', { status: label(value), count: list.counts[value] }),
      current: status === value,
    })),
  ];
  return (
    <>
      <h1 className={styles.h1}>{t('admin.reports.title')}</h1>
      <p className={styles.text}>{t('admin.reports.intro')}</p>
      {list.platformAdmin && !list.canTriage ? (
        <p className={styles.notice}>{t('admin.reports.platformAdmin')}</p>
      ) : null}
      <nav aria-label={t('admin.reports.filter')}>
        <ul className={styles.tags}>
          {filters.map((filter) => (
            <li key={filter.href}>
              <Link
                className={styles.tag}
                href={filter.href}
                aria-current={filter.current ? 'page' : undefined}
              >
                {filter.text}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {list.reports.length === 0 ? (
        <p className={styles.text}>{t('admin.reports.empty')}</p>
      ) : (
        <ul className={styles.cards}>
          {list.reports.map((report) => {
            const election = report.election
              ? inLanguage(report.election.name, locale, tenant.defaultLocale)
              : undefined;
            const party = report.cell
              ? inLanguage(report.cell.partyName, locale, tenant.defaultLocale)
              : undefined;
            const criterion = report.cell
              ? inLanguage(report.cell.criterionName, locale, tenant.defaultLocale)
              : undefined;
            return (
              <li key={report.id} className={styles.card}>
                <h2 className={styles.h3}>
                  <Link className={styles.link} href={`${base}/${report.id}`}>
                    {label(report.status)} · {t(`admin.reports.kinds.${report.kind}`)}
                  </Link>
                  {report.partyRepresentative ? ` · ${t('admin.reports.representative')}` : null}
                </h2>
                <p className={styles.muted}>
                  {t('admin.reports.received')}{' '}
                  {new Date(report.createdAt).toLocaleString(locale, {
                    dateStyle: 'long',
                    timeStyle: 'short',
                  })}
                </p>
                <p>
                  {t('admin.reports.about')}{' '}
                  {election ? <Lang value={election} page={locale} /> : null}
                  {party && criterion ? (
                    <>
                      {' · '}
                      <Lang value={party} page={locale} /> ·{' '}
                      <Lang value={criterion} page={locale} />
                    </>
                  ) : null}
                </p>
                <p className={styles.muted}>
                  {report.anonymized ? t('admin.reports.anonymized') : report.excerpt}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
};

export default ReportsPage;
