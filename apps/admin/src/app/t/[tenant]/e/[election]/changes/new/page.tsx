import type { Metadata } from 'next';

import { sitePath } from '@aiontheballot/domain/site-paths';
import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ChangeForm } from '@/changes/ChangeForm';
import { ChangeSetForm } from '@/changes/ChangeSetForm';
import { type ChangeAction, type ChangeTarget, getChanges } from '@/changes/data';
import { ADD_FIELDS, type FieldKind, UPDATE_FIELDS } from '@/changes/fields';
import { changeFormText, imageFieldText } from '@/changes/text';
import { getTenant } from '@/data';
import {
  getCriteria,
  getElection,
  getMethodology,
  getParties,
  SOURCE_KINDS,
} from '@/elections/data';
import { getLocale } from '@/locale';
import { type InLanguage, inLanguage } from '@/localized';
import { getReports } from '@/reports/data';
import { territoriesOf } from '@/territories';
import { Lang } from '@/ui/Lang';
import { localeOptions } from '@/ui/locales';
import * as styles from '@/ui/styles';

type Params = {
  params: Promise<{ tenant: string; election: string }>;
  searchParams: Promise<{ target?: string; id?: string; action?: string; report?: string }>;
};

export const generateMetadata = async (): Promise<Metadata> => ({
  title: getTranslator(await getLocale())('admin.changes.form.title'),
});

const TARGETS: readonly ChangeTarget[] = [
  'election',
  'methodology',
  'methodology_reviewer',
  'party',
  'criterion',
];
const ACTIONS: readonly ChangeAction[] = ['update', 'add', 'retire'];

/**
 * Proposes a change to a live election (editorial workflow CR1): `?target=party&id=…` to change a party's details (any
 * of them at once, PLAN R183), `&action=add` for a new one, `&action=retire` to retire one; the election and its
 * methodology are targets of their own. The target's current values come from the same reads as its screens; the
 * database reads them again when the request is made.
 */
const NewChangePage = async ({ params, searchParams }: Params) => {
  const { tenant: slug, election: electionSlug } = await params;
  const query = await searchParams;
  const target = TARGETS.find((candidate) => candidate === query.target);
  const action = ACTIONS.find((candidate) => candidate === (query.action ?? 'update'));
  if (!target || !action) {
    notFound();
  }
  const [overview, found, changes, parties, criteria, methodology, reports] = await Promise.all([
    getTenant(slug),
    getElection(slug, electionSlug),
    getChanges(slug, electionSlug),
    getParties(slug, electionSlug),
    getCriteria(slug, electionSlug),
    getMethodology(slug, electionSlug),
    getReports(slug),
  ]);
  if (!overview || !found || !changes || !parties || !criteria || !methodology) {
    notFound();
  }
  const { tenant } = overview;
  const { election } = found;
  if (election.status !== 'live' || !changes.canPropose) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);

  // The target: its name for the heading and its values now, by column, for an update or a retirement.
  let name: InLanguage | undefined;
  let current: Record<string, unknown> = {};
  let targetId: string | null = null;
  let logo: { src: string | null; upload: string; alt: string } | undefined;
  if (target === 'election') {
    if (action !== 'update') {
      notFound();
    }
    targetId = election.id;
    current = { name: election.name, election_date: election.date };
  } else if (target === 'methodology') {
    if (action !== 'update' || !methodology.methodology) {
      notFound();
    }
    targetId = methodology.methodology.id;
    current = {
      body: methodology.methodology.body,
      admissible_source_kinds: methodology.methodology.admissibleSourceKinds,
      not_mentioned_source_kinds: methodology.methodology.notMentionedSourceKinds,
    };
  } else if (action !== 'add') {
    if (!query.id) {
      notFound();
    }
    if (target === 'party') {
      const party = parties.parties.find(
        (candidate) => candidate.id === query.id && !candidate.retired,
      );
      if (!party) {
        notFound();
      }
      name = inLanguage(party.name, locale, tenant.defaultLocale);
      const partyApi = `/api/t/${tenant.slug}/e/${election.slug}/parties/${party.id}`;
      logo = {
        src: party.logo ? `${partyApi}/logo?v=${party.logo.sha256.slice(0, 12)}` : null,
        upload: `${partyApi}/proposed-logo`,
        alt: t('admin.parties.logoAlt', { name: name?.text ?? party.slug }),
      };
      current = {
        name: party.name,
        short_name: party.shortName,
        logo_file_id: party.logo?.id ?? null,
        colour: party.colour,
        website: party.website,
        territory_codes: party.territoryCodes,
        display_order: party.displayOrder,
      };
    } else if (target === 'criterion') {
      const criterion = criteria.criteria.find(
        (candidate) => candidate.id === query.id && !candidate.retired,
      );
      if (!criterion) {
        notFound();
      }
      name = inLanguage(criterion.title, locale, tenant.defaultLocale);
      current = {
        title: criterion.title,
        short_title: criterion.shortTitle,
        description: criterion.description,
        display_order: criterion.displayOrder,
      };
    } else {
      const reviewer = methodology.methodology?.reviewers.find(
        (candidate) => candidate.id === query.id && !candidate.retired,
      );
      if (!reviewer) {
        notFound();
      }
      name = { text: reviewer.name, lang: tenant.defaultLocale };
      current = {
        name: reviewer.name,
        affiliation: reviewer.affiliation,
        display_order: reviewer.displayOrder,
      };
    }
    targetId = query.id;
  }
  const fields: Readonly<Record<string, FieldKind>> =
    action === 'update'
      ? UPDATE_FIELDS[target]
      : action === 'add'
        ? (ADD_FIELDS[target] ?? {})
        : {};
  if (action === 'add' && !ADD_FIELDS[target]) {
    notFound();
  }
  const base = `/t/${tenant.slug}/e/${election.slug}/changes`;
  const path = `/api/t/${tenant.slug}/e/${election.slug}/changes`;
  // Reports a change may answer (CR1.8): this election's, past triage, as their member's queue shows them.
  const answerable = (reports?.reports ?? [])
    .filter(
      (report) =>
        report.election?.slug === election.slug &&
        (report.status === 'triaged' || report.status === 'accepted'),
    )
    .map((report) => ({
      id: report.id,
      label: `${new Date(report.createdAt).toLocaleDateString(locale, { dateStyle: 'medium' })} · ${t(
        `admin.reports.kinds.${report.kind}`,
      )}${report.excerpt ? ` · ${report.excerpt.slice(0, 60)}` : ''}`,
    }));
  const common = {
    path,
    targetKind: target,
    locales: localeOptions(tenant, locale),
    locale,
    sourceKinds: SOURCE_KINDS,
    territories: territoriesOf(tenant.countryCode),
    canApply: changes.canApprove && changes.ownApprovals,
    reports: answerable,
    report: query.report,
    text: changeFormText(t),
  };
  return (
    <>
      <p>
        <Link className={styles.link} href={base}>
          {t('admin.changes.title')}
        </Link>
      </p>
      <h2 className={styles.h2}>
        {action === 'update' ? t('admin.changes.form.editTitle') : t('admin.changes.form.title')}
      </h2>
      <p className={styles.text}>
        {t(`admin.changes.kinds.${target}`)}
        {name ? (
          <>
            {' '}
            <Lang value={name} page={locale} />
          </>
        ) : null}
        {action === 'update' ? null : ` · ${t(`admin.changes.actions.${action}`, { field: '' })}`}
      </p>
      {action === 'update' && targetId ? (
        <>
          <p className={styles.text}>{t('admin.changes.form.editIntro')}</p>
          <ChangeSetForm
            {...common}
            then={base}
            targetId={targetId}
            fields={fields}
            current={current}
            logo={logo}
            imageText={imageFieldText(t)}
          />
        </>
      ) : action !== 'update' ? (
        <ChangeForm
          {...common}
          then={base}
          action={action}
          targetId={targetId}
          fields={fields}
          slugAddress={
            target === 'party'
              ? sitePath(tenant.defaultLocale, {
                  page: 'party',
                  election: election.slug,
                  party: '{slug}',
                })
              : target === 'criterion'
                ? sitePath(tenant.defaultLocale, {
                    page: 'criterion',
                    election: election.slug,
                    criterion: '{slug}',
                  })
                : undefined
          }
        />
      ) : null}
    </>
  );
};

export default NewChangePage;
