import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getTenant } from '@/data';
import { getElection, getParties } from '@/elections/data';
import { PartyForm } from '@/elections/PartyForm';
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

/** One party of a draft election (editorial workflow E4), changed or deleted while the election is a draft. */
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
