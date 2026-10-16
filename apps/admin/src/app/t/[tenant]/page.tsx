import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getSignupCounts, getTenant, mayAct } from '@/data';
import { getLocale } from '@/locale';
import { inLanguage, siteName } from '@/localized';
import { previewConfig, previewRoot } from '@/preview';
import { getQueues, type Queue, type QueueCell } from '@/queues/data';
import { requireStage } from '@/session';
import { Lang } from '@/ui/Lang';
import * as styles from '@/ui/styles';

type Params = { params: Promise<{ tenant: string }> };

export const generateMetadata = async ({ params }: Params): Promise<Metadata> => {
  const overview = await getTenant((await params).tenant);
  const locale = await getLocale();
  const t = getTranslator(locale);
  return {
    title: overview
      ? `${t('admin.shell.dashboard')} · ${siteName(overview.tenant, locale).text}`
      : t('admin.notFound.title'),
  };
};

/**
 * A tenant's dashboard (editorial workflow A6.1, where a member of one site lands): the user's roles, what waits for
 * them (the work queues of C1.2), the site's sections, and for country admins and platform admins the signup list's
 * counts.
 */
const Dashboard = async ({ params }: Params) => {
  await requireStage('signed-in');
  const overview = await getTenant((await params).tenant);
  if (!overview) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  const { tenant, roles, platformAdmin } = overview;
  // The signup list's counts (PLAN R119): for country admins and platform admins, as the API allows.
  const [signups, queues] = await Promise.all([
    mayAct(overview, 'country_admin') ? getSignupCounts(tenant.slug) : undefined,
    getQueues(tenant.slug),
  ]);
  const base = `/t/${tenant.slug}`;
  const local = (value: Record<string, string>, fallback: string) =>
    inLanguage(value, locale, tenant.defaultLocale)?.text ?? fallback;
  const cellLink = (cell: QueueCell) => ({
    key: `${cell.election.slug}/${cell.partyId}/${cell.criterionId}`,
    href: `${base}/e/${cell.election.slug}/cells/${cell.partyId}/${cell.criterionId}`,
    label: t('admin.dashboard.queues.cell', {
      party: local(cell.partyName, cell.partyId),
      criterion: local(cell.criterionName, cell.criterionId),
      election: local(cell.election.name, cell.election.slug),
    }),
  });
  /** One queue: its heading with how many wait, its first items, and how many more; nothing when it is empty. */
  const queueOf = <T,>(
    id: string,
    title: string,
    queue: Queue<T> | null | undefined,
    link: (item: T) => { key: string; href: string; label: string },
  ) =>
    queue && queue.total > 0 ? (
      <section key={id} aria-labelledby={id} className={styles.queue}>
        <h3 id={id} className={styles.h3}>
          {title}
        </h3>
        <ul className={styles.list}>
          {queue.items.map((item) => {
            const { key, href, label } = link(item);
            return (
              <li key={key}>
                <Link className={styles.link} href={href}>
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
        {queue.total > queue.items.length ? (
          <p className={styles.hint}>
            {t('admin.dashboard.queues.more', { count: queue.total - queue.items.length })}
          </p>
        ) : null}
      </section>
    ) : null;
  const waiting = queues
    ? [
        queueOf(
          'queue-returned',
          t('admin.dashboard.queues.returned', { count: queues.returned.total }),
          queues.returned,
          cellLink,
        ),
        queueOf(
          'queue-drafts',
          t('admin.dashboard.queues.drafts', { count: queues.drafts.total }),
          queues.drafts,
          cellLink,
        ),
        queueOf(
          'queue-review',
          t('admin.dashboard.queues.review', { count: queues.review?.total ?? 0 }),
          queues.review,
          cellLink,
        ),
        queueOf(
          'queue-recheck',
          t('admin.dashboard.queues.recheck', { count: queues.recheck?.total ?? 0 }),
          queues.recheck,
          cellLink,
        ),
        queueOf(
          'queue-changes',
          t('admin.dashboard.queues.changes', { count: queues.changes.total }),
          queues.changes,
          (change) => ({
            key: change.id,
            href: `${base}/e/${change.election.slug}/changes`,
            label: t('admin.dashboard.queues.change', {
              target: t(`admin.changes.kinds.${change.targetKind}`),
              action:
                change.action === 'update'
                  ? t('admin.changes.actions.update', { field: '' }).trim()
                  : t(`admin.changes.actions.${change.action}`),
              election: local(change.election.name, change.election.slug),
            }),
          }),
        ),
        queueOf(
          'queue-sources',
          t('admin.dashboard.queues.failedSources', { count: queues.failedSources?.total ?? 0 }),
          queues.failedSources,
          (source) => ({
            key: source.id,
            href: `${base}/e/${source.election.slug}/sources/${source.id}`,
            label: t('admin.dashboard.queues.source', {
              title: source.title,
              election: local(source.election.name, source.election.slug),
            }),
          }),
        ),
      ].filter(Boolean)
    : [];
  return (
    <>
      <h1 className={styles.h1}>
        <Lang value={siteName(tenant, locale)} page={locale} />
      </h1>
      <p className={styles.text}>
        {roles.length > 0
          ? t('admin.dashboard.yourRoles', {
              roles: new Intl.ListFormat(locale, { type: 'conjunction' }).format(
                roles.map((role) => t(`admin.roles.${role}`).toLocaleLowerCase(locale)),
              ),
            })
          : t('admin.dashboard.noRoles')}
        {platformAdmin ? ` ${t('admin.dashboard.platformAdmin')}` : null}
      </p>
      {tenant.active ? null : <p className={styles.notice}>{t('admin.dashboard.notPublic')}</p>}
      {/* The site as it will look once open (ADR-0005, PLAN R174): for an active site, when the preview is set up. */}
      {tenant.active && previewConfig() ? (
        <p className={styles.text}>
          {/* A plain link: the preview is no page of the admin's app, so the browser loads it whole. */}
          <a className={styles.link} href={previewRoot(tenant.slug)}>
            {t('admin.dashboard.preview')}
          </a>{' '}
          <span className={styles.hint}>{t('admin.dashboard.previewHint')}</span>
        </p>
      ) : null}
      {queues ? (
        <section aria-labelledby="queues">
          <h2 id="queues" className={styles.h2}>
            {t('admin.dashboard.queues.title')}
          </h2>
          <p className={styles.text}>{t('admin.dashboard.queues.intro')}</p>
          {waiting.length === 0 ? (
            <p className={styles.text}>{t('admin.dashboard.queues.nothing')}</p>
          ) : (
            waiting
          )}
          {queues.reports !== null ? (
            <p className={styles.text}>
              <Link className={styles.link} href={`${base}/reports?status=new`}>
                {t('admin.dashboard.queues.reports', { count: queues.reports })}
              </Link>
            </p>
          ) : null}
        </section>
      ) : null}
      <h2 className={styles.h2}>{t('admin.dashboard.sections')}</h2>
      <ul className={styles.cards}>
        <li className={styles.card}>
          <Link className={styles.cardLink} href={`${base}/elections`}>
            {t('admin.shell.elections')}
          </Link>
          <span className={styles.muted}>{t('admin.dashboard.electionsIntro')}</span>
        </li>
        <li className={styles.card}>
          <Link className={styles.cardLink} href={`${base}/members`}>
            {t('admin.shell.members')}
          </Link>
          <span className={styles.muted}>{t('admin.dashboard.membersIntro')}</span>
        </li>
        <li className={styles.card}>
          <Link className={styles.cardLink} href={`${base}/settings`}>
            {t('admin.shell.settings')}
          </Link>
          <span className={styles.muted}>{t('admin.dashboard.settingsIntro')}</span>
        </li>
      </ul>
      {signups && (
        <section aria-labelledby="lista-de-avisos">
          <h2 id="lista-de-avisos" className={styles.h2}>
            {t('admin.dashboard.signups.title')}
          </h2>
          <p className={styles.text}>{t('admin.dashboard.signups.intro')}</p>
          <ul className={styles.text}>
            <li>{t('admin.dashboard.signups.confirmed', { count: signups.confirmed })}</li>
            <li>
              {t('admin.dashboard.signups.futureElections', { count: signups.futureElections })}
            </li>
            <li>{t('admin.dashboard.signups.unconfirmed', { count: signups.unconfirmed })}</li>
          </ul>
        </section>
      )}
    </>
  );
};

export default Dashboard;
