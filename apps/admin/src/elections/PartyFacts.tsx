import { getTranslator } from '@aiontheballot/i18n/messages';

import { inLanguage } from '@/localized';
import { territoriesOf } from '@/territories';
import { Lang } from '@/ui/Lang';
import * as styles from '@/ui/styles';

import type { Party } from './data';

/**
 * A party's details as they are, for whoever can't edit them here: a live election's (they change through a change
 * request, PLAN R183), an archived one's, or a reviewer's view. Each in words, the colour beside its code, a territory's
 * name beside its code where ISO lists it (PLAN R201).
 */
export const PartyFacts = ({
  party,
  logo,
  logoAlt,
  locale,
  defaultLocale,
  countryCode,
}: {
  party: Party;
  logo: string | null;
  logoAlt: string;
  locale: string;
  defaultLocale: string;
  countryCode: string;
}) => {
  const t = getTranslator(locale as Parameters<typeof getTranslator>[0]);
  const none = t('admin.parties.noneValue');
  const territoryNames = new Map(
    territoriesOf(countryCode).map((territory) => [territory.code, territory.name]),
  );
  const text = (value: Party['name']) => {
    const found = inLanguage(value, locale, defaultLocale);
    return found ? <Lang value={found} page={locale} /> : none;
  };
  return (
    <dl className={styles.facts}>
      <dt>{t('admin.parties.name')}</dt>
      <dd>{text(party.name)}</dd>
      <dt>{t('admin.parties.shortName')}</dt>
      <dd>{text(party.shortName)}</dd>
      <dt>{t('admin.parties.slugFact')}</dt>
      <dd className={styles.prefixed}>{party.slug}</dd>
      <dt>{t('admin.parties.logo')}</dt>
      <dd>
        {logo ? (
          <div className={styles.imageBox}>
            {/* The API serves it to members only, with nothing for next/image to do. */}
            {/* oxlint-disable-next-line next/no-img-element */}
            <img src={logo} alt={logoAlt} />
          </div>
        ) : (
          none
        )}
      </dd>
      <dt>{t('admin.parties.colour')}</dt>
      <dd>
        {party.colour ? (
          <span className={styles.prefixed}>
            <span
              className={styles.swatch}
              style={{ backgroundColor: party.colour }}
              aria-hidden="true"
            />
            {party.colour}
          </span>
        ) : (
          none
        )}
      </dd>
      <dt>{t('admin.parties.website')}</dt>
      <dd>
        {party.website ? (
          <a className={styles.link} href={party.website} rel="noreferrer noopener" target="_blank">
            {party.website}
          </a>
        ) : (
          none
        )}
      </dd>
      <dt>{t('admin.parties.territories')}</dt>
      <dd>
        {party.territoryCodes
          ?.map((code) => {
            const name = territoryNames.get(code);
            return name ? `${name} (${code})` : code;
          })
          .join(', ') ?? t('admin.parties.everywhere')}
      </dd>
    </dl>
  );
};
