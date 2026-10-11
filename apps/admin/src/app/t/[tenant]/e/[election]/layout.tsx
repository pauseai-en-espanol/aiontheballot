import type { ReactNode } from 'react';

import { getTranslator } from '@aiontheballot/i18n/messages';
import { notFound } from 'next/navigation';

import { getTenant } from '@/data';
import { getElection } from '@/elections/data';
import { electionDate, freezeLine } from '@/elections/text';
import { getLocale } from '@/locale';
import { inLanguage } from '@/localized';
import { requireStage } from '@/session';
import { SectionNav } from '@/shell/SectionNav';
import { Lang } from '@/ui/Lang';
import * as styles from '@/ui/styles';

/**
 * Every screen of an election (editorial workflow §2.1: `/t/{tenant}/e/{election}/…`): its name, status and date, what
 * its status allows, and its sections. An election the user can't open is a 404.
 */
const ElectionLayout = async ({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tenant: string; election: string }>;
}) => {
  await requireStage('signed-in');
  const { tenant: slug, election: electionSlug } = await params;
  const [overview, found] = await Promise.all([getTenant(slug), getElection(slug, electionSlug)]);
  if (!overview || !found) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  const { election } = found;
  const name = inLanguage(election.name, locale, overview.tenant.defaultLocale) ?? {
    text: election.slug,
    lang: locale,
  };
  const base = `/t/${overview.tenant.slug}/e/${election.slug}`;
  return (
    <>
      <p className={styles.eyebrow}>{t('admin.shell.elections')}</p>
      <h1 className={styles.h1}>
        <Lang value={name} page={locale} />
      </h1>
      <p className={styles.text}>
        <strong>{t(`admin.elections.statuses.${election.status}`)}</strong>
        {' · '}
        {electionDate(t, election.date)}
      </p>
      {freezeLine(t, election) ? <p className={styles.notice}>{freezeLine(t, election)}</p> : null}
      {election.status === 'draft' ? null : (
        <p className={styles.notice}>
          {election.status === 'live'
            ? t('admin.election.liveNotice')
            : t('admin.election.archivedNotice')}
        </p>
      )}
      <SectionNav
        label={t('admin.election.nav')}
        sections={[
          { href: base, label: t('admin.election.overview') },
          { href: `${base}/methodology`, label: t('admin.election.methodology') },
          { href: `${base}/parties`, label: t('admin.election.parties') },
          { href: `${base}/criteria`, label: t('admin.election.criteria') },
        ]}
        variant="inline"
      />
      <div className={styles.section}>{children}</div>
    </>
  );
};

export default ElectionLayout;
