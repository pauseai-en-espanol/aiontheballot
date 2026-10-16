import type { Metadata } from 'next';

import { sitePath } from '@aiontheballot/domain/site-paths';
import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getTenant } from '@/data';
import { editedDirectly, getElection, getParties, getRechecks } from '@/elections/data';
import { PartyFacts } from '@/elections/PartyFacts';
import { PartyForm } from '@/elections/PartyForm';
import { ProgrammeForm } from '@/elections/ProgrammeForm';
import { RecheckList } from '@/elections/RecheckList';
import { partyFormText } from '@/elections/structure-text';
import { getLocale } from '@/locale';
import { inLanguage } from '@/localized';
import { territoriesOf } from '@/territories';
import { ConfirmButton } from '@/ui/ConfirmButton';
import { FormSection } from '@/ui/FormSection';
import { Lang } from '@/ui/Lang';
import { localeOptions } from '@/ui/locales';
import * as styles from '@/ui/styles';
import { writeErrors } from '@/ui/text';

type Params = { params: Promise<{ tenant: string; election: string; id: string }> };

export const generateMetadata = async ({ params }: Params): Promise<Metadata> => {
  const { tenant, election, id } = await params;
  const locale = await getLocale();
  const t = getTranslator(locale);
  const [overview, data] = await Promise.all([getTenant(tenant), getParties(tenant, election)]);
  const party = data?.parties.find((candidate) => candidate.id === id);
  const name =
    party && overview
      ? inLanguage(party.name, locale, overview.tenant.defaultLocale)?.text
      : undefined;
  return { title: `${name ?? t('admin.parties.edit')} · ${t('admin.election.parties')}` };
};

/**
 * One party of an election (admin forms §2, "the party page"): its name, logo and short name first; then its details,
 * edited here while the election is a draft or in preview (E4), the logo with them, or shown with "Propose a change"
 * once it is live (CR1, PLAN R183); then its programme, checked even once the election is live (PS1); and, last and on
 * its own, deleting it, while that is possible.
 */
const PartyPage = async ({ params }: Params) => {
  const { tenant: slug, election: electionSlug, id } = await params;
  const [overview, found, data] = await Promise.all([
    getTenant(slug),
    getElection(slug, electionSlug),
    getParties(slug, electionSlug),
  ]);
  if (!overview || !found || !data) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  const { tenant } = overview;
  const { election } = found;
  const base = `/t/${tenant.slug}/e/${election.slug}/parties`;
  const api = `/api/t/${tenant.slug}/e/${election.slug}/parties`;
  const editable = data.canEdit && editedDirectly(election.status);
  const item = data.parties.find((candidate) => candidate.id === id);
  if (!item) {
    notFound();
  }
  const name = inLanguage(item.name, locale, tenant.defaultLocale) ?? {
    text: item.slug,
    lang: locale,
  };
  const shortName = inLanguage(item.shortName, locale, tenant.defaultLocale);
  const logo = item.logo ? `${api}/${item.id}/logo?v=${item.logo.sha256.slice(0, 12)}` : null;
  const logoAlt = t('admin.parties.logoAlt', { name: name.text });
  const changes = `/t/${tenant.slug}/e/${election.slug}/changes/new?target=party&id=${item.id}`;
  // Its "not mentioned" ratings checked only against replaced documents, its old programme (D20, PLAN R187).
  const rechecks =
    election.status === 'draft'
      ? []
      : ((await getRechecks(slug, electionSlug))?.rechecks ?? []).filter(
          (recheck) => recheck.party.id === item.id,
        );
  return (
    <>
      <p>
        <Link className={styles.link} href={base}>
          {t('admin.election.parties')}
        </Link>
      </p>
      <header className={styles.entityHeader}>
        {logo ? (
          <div className={styles.imageBox}>
            {/* The API serves it to members only, with nothing for next/image to do. */}
            {/* oxlint-disable-next-line next/no-img-element */}
            <img src={logo} alt={logoAlt} />
          </div>
        ) : null}
        <div>
          <h2 className={styles.h2}>
            <Lang value={name} page={locale} />
          </h2>
          <p className={styles.muted}>
            {shortName ? <Lang value={shortName} page={locale} /> : null}
            {item.retired ? ` · ${t('admin.structure.retired')}` : null}
          </p>
        </div>
      </header>
      <FormSection id="data" level={3} title={t('admin.parties.data')}>
        {editable ? (
          <PartyForm
            path={`${api}/${item.id}`}
            method="PUT"
            partiesPath={api}
            pagesPath={base}
            values={{
              slug: item.slug,
              name: item.name,
              shortName: item.shortName,
              colour: item.colour,
              website: item.website,
              territoryCodes: item.territoryCodes,
              logo,
              displayName: name.text,
            }}
            countryCode={tenant.countryCode}
            territories={territoriesOf(tenant.countryCode)}
            locales={localeOptions(tenant, locale)}
            locale={locale}
            slugAddress={sitePath(tenant.defaultLocale, {
              page: 'party',
              election: election.slug,
              party: '{slug}',
            })}
            text={partyFormText(t, true)}
          />
        ) : (
          <>
            {election.status === 'live' && data.canEdit && !item.retired ? (
              <p className={styles.text}>{t('admin.parties.dataLive')}</p>
            ) : null}
            <PartyFacts
              party={item}
              logo={logo}
              logoAlt={logoAlt}
              locale={locale}
              defaultLocale={tenant.defaultLocale}
              countryCode={tenant.countryCode}
            />
            {election.status === 'live' && data.canEdit && !item.retired ? (
              <div className={styles.formActions}>
                <Link className={styles.button} href={changes}>
                  {t('admin.parties.proposeChange')}
                </Link>
                <Link className={styles.link} href={`${changes}&action=retire`}>
                  {t('admin.changes.retire')}
                </Link>
              </div>
            ) : election.status !== 'live' ? (
              <p className={styles.text}>{t('admin.structure.readOnly')}</p>
            ) : null}
          </>
        )}
      </FormSection>
      <FormSection
        id="programme"
        level={3}
        title={t('admin.parties.programme.title')}
        description={t('admin.parties.programme.intro')}
      >
        <RecheckList
          rechecks={rechecks}
          base={`/t/${tenant.slug}/e/${election.slug}`}
          locale={locale}
          defaultLocale={tenant.defaultLocale}
          withParty={false}
          level={4}
        />
        <p className={styles.text}>
          {t('admin.parties.programme.status', {
            status: t(`admin.parties.programme.${item.programmeStatus}`),
          })}{' '}
          {item.programmeCheckedAt
            ? t('admin.parties.programme.checkedOn', { date: new Date(item.programmeCheckedAt) })
            : t('admin.parties.programme.neverChecked')}
        </p>
        {data.canEdit && election.status !== 'archived' && !item.retired ? (
          <ProgrammeForm
            path={`${api}/${item.id}/programme`}
            canPublish={item.hasProgrammeSource}
            text={{
              checkPending: t('admin.parties.programme.checkPending'),
              checkPublished: t('admin.parties.programme.checkPublished'),
              needsSource: t('admin.parties.programme.needsSource'),
              saved: t('admin.parties.programme.saved'),
              errors: writeErrors(t),
            }}
          />
        ) : election.status === 'archived' ? (
          <p className={styles.text}>{t('admin.parties.programme.readOnly')}</p>
        ) : item.retired ? (
          <p className={styles.text}>{t('admin.parties.programme.retired')}</p>
        ) : null}
      </FormSection>
      {editable ? (
        <FormSection id="delete" level={3} danger title={t('admin.parties.deleteSection')}>
          <ConfirmButton
            method="DELETE"
            path={`${api}/${item.id}`}
            then={base}
            text={{
              button: t('admin.parties.delete'),
              title: t('admin.parties.deleteTitle'),
              body: t('admin.parties.deleteBody'),
              confirm: t('admin.parties.delete'),
              cancel: t('admin.members.cancel'),
              done: '',
              errors: { ...writeErrors(t), linked: t('admin.structure.deleteLinked') },
            }}
          />
        </FormSection>
      ) : null}
    </>
  );
};

export default PartyPage;
