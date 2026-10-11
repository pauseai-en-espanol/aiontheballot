import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getSignupCounts, getTenant, mayAct } from '@/data';
import { getLocale } from '@/locale';
import { siteName } from '@/localized';
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
 * A tenant's dashboard (editorial workflow A6.1, where a member of one site lands): the user's roles and the site's
 * sections, and for country admins and platform admins the signup list's counts. The work queues of C1.2 come with
 * cell editing.
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
  const signups = mayAct(overview, 'country_admin')
    ? await getSignupCounts(tenant.slug)
    : undefined;
  const base = `/t/${tenant.slug}`;
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
      <p className={styles.text}>{t('admin.dashboard.queuesLater')}</p>
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
