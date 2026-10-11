import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getTenant } from '@/data';
import { getElection, getParties } from '@/elections/data';
import { PartyForm } from '@/elections/PartyForm';
import { ProgrammeForm } from '@/elections/ProgrammeForm';
import { partyFormText } from '@/elections/structure-text';
import { getLocale } from '@/locale';
import { ConfirmButton } from '@/ui/ConfirmButton';
import { localeOptions } from '@/ui/locales';
import * as styles from '@/ui/styles';
import { writeErrors } from '@/ui/text';

type Params = { params: Promise<{ tenant: string; election: string; id: string }> };

export const generateMetadata = async (): Promise<Metadata> => {
  const t = getTranslator(await getLocale());
  return { title: `${t('admin.parties.edit')} · ${t('admin.election.parties')}` };
};

/**
 * One party of an election: its programme status, checked even once the election is live (editorial workflow PS1), and
 * its fields, changed or deleted while the election is a draft (E4).
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
  const editable = data.canEdit && election.status === 'draft';
  const item = data.parties.find((candidate) => candidate.id === id);
  if (!item) {
    notFound();
  }
  return (
    <>
      <p>
        <Link className={styles.link} href={base}>
          {t('admin.election.parties')}
        </Link>
      </p>
      <h2 className={styles.h2}>{t('admin.parties.edit')}</h2>
      <section aria-labelledby="programme" className={styles.section}>
        <h3 id="programme" className={styles.h3}>
          {t('admin.parties.programme.title')}
        </h3>
        <p className={styles.text}>{t('admin.parties.programme.intro')}</p>
        <p className={styles.text}>
          {t('admin.parties.programme.status', {
            status: t(`admin.parties.programme.${item.programmeStatus}`),
          })}{' '}
          {item.programmeCheckedAt
            ? t('admin.parties.programme.checkedOn', { date: new Date(item.programmeCheckedAt) })
            : t('admin.parties.programme.neverChecked')}
        </p>
        {data.canEdit && election.status !== 'archived' ? (
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
        ) : null}
      </section>
      {editable ? (
        <>
          <PartyForm
            path={`${api}/${item.id}`}
            method="PUT"
            then={base}
            values={{
              slug: item.slug,
              name: item.name,
              shortName: item.shortName,
              colour: item.colour,
              website: item.website,
              territoryCodes: item.territoryCodes,
            }}
            countryCode={tenant.countryCode}
            locales={localeOptions(tenant, locale)}
            text={partyFormText(t)}
          />
          <h3 className={styles.h3}>{t('admin.parties.delete')}</h3>
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
        </>
      ) : (
        <p className={styles.text}>{t('admin.structure.readOnly')}</p>
      )}
    </>
  );
};

export default PartyPage;
