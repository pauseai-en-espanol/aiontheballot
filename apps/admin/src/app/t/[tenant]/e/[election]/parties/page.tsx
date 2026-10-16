import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getTenant } from '@/data';
import { editedDirectly, getElection, getParties } from '@/elections/data';
import { OrderedList } from '@/elections/OrderedList';
import { getLocale } from '@/locale';
import { inLanguage } from '@/localized';
import * as styles from '@/ui/styles';
import { template, writeErrors } from '@/ui/text';

type Params = { params: Promise<{ tenant: string; election: string }> };

export const generateMetadata = async ({ params }: Params): Promise<Metadata> => {
  const { tenant, election } = await params;
  const [overview, found] = await Promise.all([getTenant(tenant), getElection(tenant, election)]);
  const locale = await getLocale();
  const t = getTranslator(locale);
  if (!overview || !found) {
    return { title: t('admin.notFound.title') };
  }
  const name = inLanguage(found.election.name, locale, overview.tenant.defaultLocale)?.text;
  return { title: `${t('admin.election.parties')} · ${name ?? election}` };
};

/**
 * An election's parties in their display order (editorial workflow E4): editors add, change, reorder and delete them
 * while the election is a draft; once it is live they change only through change requests.
 */
const PartyListPage = async ({ params }: Params) => {
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
  const editable = data.canEdit && editedDirectly(election.status);
  const base = `/t/${tenant.slug}/e/${election.slug}/parties`;
  const api = `/api/t/${tenant.slug}/e/${election.slug}/parties`;
  // A mark's box before every name once any party has a logo or a colour, so the names line up (PLAN R184).
  const marked = data.parties.some((item) => Boolean(item.logo || item.colour));
  const items = data.parties.map((item) => {
    const name = inLanguage(item.name, locale, tenant.defaultLocale) ?? {
      text: item.slug,
      lang: locale,
    };
    const shortName = inLanguage(item.shortName, locale, tenant.defaultLocale)?.text;
    return {
      id: item.id,
      name: name.text,
      lang: name.lang,
      details: [
        ...(shortName && shortName !== name.text ? [shortName] : []),
        item.slug,
        ...(item.colour ? [item.colour] : []),
        ...(item.retired ? [t('admin.structure.retired')] : []),
      ],
      // What a party still lacks before the public sees it well: said in words, never by a missing picture alone.
      missing: item.retired
        ? []
        : [
            ...(item.logo ? [] : [t('admin.parties.missing.logo')]),
            ...(item.colour ? [] : [t('admin.parties.missing.colour')]),
            ...(item.programmeCheckedAt ? [] : [t('admin.parties.missing.programme')]),
          ],
      // The party's mark (PLAN R184): its logo, else its colour as a rounded square, in a box of one size; under a
      // logo, its colour as a line (under the name it would read as a second underline of the link).
      lead: marked ? (
        <span className={styles.markColumn} aria-hidden="true">
          <span className={styles.listThumb}>
            {item.logo ? (
              // The API serves it to members only, with nothing for next/image to do; the name beside it says whose.
              // oxlint-disable-next-line next/no-img-element
              <img src={`${api}/${item.id}/logo?v=${item.logo.sha256.slice(0, 12)}`} alt="" />
            ) : item.colour ? (
              <svg width="40" height="40" viewBox="0 0 40 40" focusable="false">
                <rect
                  x="4.75"
                  y="4.75"
                  width="30.5"
                  height="30.5"
                  rx="8"
                  fill={item.colour}
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
            ) : null}
          </span>
          <svg
            className={styles.markLine}
            viewBox="0 0 40 4"
            preserveAspectRatio="none"
            focusable="false"
          >
            {item.logo && item.colour ? (
              <rect width="40" height="4" rx="2" fill={item.colour} />
            ) : null}
          </svg>
        </span>
      ) : undefined,
      href: `${base}/${item.id}`,
    };
  });
  return (
    <>
      <h2 className={styles.h2}>{t('admin.election.parties')}</h2>
      <p className={styles.text}>{t('admin.parties.intro')}</p>
      {items.length === 0 ? (
        <p className={styles.text}>{t('admin.parties.none')}</p>
      ) : (
        <OrderedList
          items={items}
          orderPath={`/api/t/${tenant.slug}/e/${election.slug}/parties/order`}
          canReorder={editable}
          label={t('admin.election.parties')}
          text={{
            up: t('admin.structure.up'),
            down: t('admin.structure.down'),
            upLabel: template(t, 'admin.structure.upLabel'),
            downLabel: template(t, 'admin.structure.downLabel'),
            moved: template(t, 'admin.structure.moved'),
            errors: writeErrors(t),
          }}
        />
      )}
      {editable ? (
        <p>
          <Link className={styles.button} href={`${base}/new`}>
            {t('admin.parties.add')}
          </Link>
        </p>
      ) : null}
    </>
  );
};

export default PartyListPage;
