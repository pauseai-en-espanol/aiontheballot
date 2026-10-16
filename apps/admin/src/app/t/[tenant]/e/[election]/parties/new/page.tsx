import type { Metadata } from 'next';

import { sitePath } from '@aiontheballot/domain/site-paths';
import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getTenant } from '@/data';
import { editedDirectly, getElection, getParties } from '@/elections/data';
import { PartyForm } from '@/elections/PartyForm';
import { partyFormText } from '@/elections/structure-text';
import { getLocale } from '@/locale';
import { territoriesOf } from '@/territories';
import { localeOptions } from '@/ui/locales';
import * as styles from '@/ui/styles';

type Params = { params: Promise<{ tenant: string; election: string }> };

export const generateMetadata = async (): Promise<Metadata> => {
  const t = getTranslator(await getLocale());
  return { title: `${t('admin.parties.add')} · ${t('admin.election.parties')}` };
};

/** A new party of a draft election or one in preview (editorial workflow E4), its logo included, added last. */
const NewPartyPage = async ({ params }: Params) => {
  const { tenant: slug, election: electionSlug } = await params;
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
  return (
    <>
      <p>
        <Link className={styles.link} href={base}>
          {t('admin.election.parties')}
        </Link>
      </p>
      <h2 className={styles.h2}>{t('admin.parties.add')}</h2>
      {editable ? (
        <PartyForm
          path={api}
          method="POST"
          partiesPath={api}
          pagesPath={base}
          countryCode={tenant.countryCode}
          territories={territoriesOf(tenant.countryCode)}
          locales={localeOptions(tenant, locale)}
          locale={locale}
          slugAddress={sitePath(tenant.defaultLocale, {
            page: 'party',
            election: election.slug,
            party: '{slug}',
          })}
          text={partyFormText(t, false)}
        />
      ) : (
        <p className={styles.text}>{t('admin.structure.readOnly')}</p>
      )}
    </>
  );
};

export default NewPartyPage;
