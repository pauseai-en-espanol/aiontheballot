import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { pickLocalized } from '@aiontheballot/domain/localized';
import { getTranslator } from '@aiontheballot/i18n/messages';
import { css } from '@styled-system/css';

import { SiteFrame } from '@/components/site-frame';
import { pageMetadata } from '@/page-metadata';
import { loadSitePage, type SitePageParams } from '@/site-page';
import { focusRing, pageTitle } from '@/styles';

const TARGET = { page: 'legalNotice' } as const;

export const generateMetadata = async (props: SitePageParams): Promise<Metadata> => {
  const loaded = await loadSitePage(props);
  const t = getTranslator(loaded.locale);
  const { home } = loaded.page;
  const operator =
    pickLocalized(home.operator.displayName, loaded.locale, home.tenant.defaultLocale) ?? '';
  return pageMetadata({
    ...loaded,
    target: TARGET,
    title: t('legal.title'),
    description: t('legal.intro', { operator }),
  });
};

/**
 * The legal notice, generated from the operator's own row (BRIEF §3 invariant 3; LSSI art. 10): who runs the site and
 * how to reach them. Served from the first page, before the site opens. A field the operator hasn't given is left out.
 */
const LegalNotice = async (props: SitePageParams) => {
  const loaded = await loadSitePage(props);
  const { locale } = loaded;
  const { home } = loaded.page;
  const t = getTranslator(locale);
  const { operator } = home;
  const name = pickLocalized(operator.displayName, locale, home.tenant.defaultLocale) ?? '';
  const mail = (address: string) => (
    <a className={focusRing} href={`mailto:${address}`}>
      {address}
    </a>
  );
  const rows: { key: string; value: ReactNode }[] = [
    { key: 'holder', value: operator.legalName || null },
    { key: 'taxId', value: operator.taxId },
    { key: 'address', value: operator.address },
    { key: 'registry', value: operator.registryEntry },
    { key: 'contact', value: operator.contactEmail && mail(operator.contactEmail) },
    { key: 'privacyContact', value: operator.privacyEmail && mail(operator.privacyEmail) },
    {
      key: 'website',
      value: operator.url && (
        <a className={focusRing} href={operator.url}>
          {operator.url}
        </a>
      ),
    },
  ];
  return (
    <SiteFrame site={loaded} target={TARGET}>
      <h1 className={pageTitle}>{t('legal.title')}</h1>
      <p className={css({ fontSize: '18px', marginBottom: '24px', maxWidth: '70ch' })}>
        {t('legal.intro', { operator: name })}
      </p>
      <dl
        className={css({
          display: 'grid',
          gridTemplateColumns: { base: '1fr', sm: 'max-content 1fr' },
          gap: { base: '4px 24px', sm: '12px 32px' },
          fontSize: '18px',
          '& dt': { fontWeight: '700' },
          '& dd': { marginBottom: { base: '12px', sm: '0' }, overflowWrap: 'anywhere' },
          '& a': { textDecoration: 'underline', textUnderlineOffset: '3px' },
        })}
      >
        {rows.map(({ key, value }) =>
          value ? (
            <div key={key} className={css({ display: 'contents' })}>
              <dt>{t(`legal.${key as 'holder'}`)}</dt>
              <dd className={css({ whiteSpace: 'pre-line' })}>{value}</dd>
            </div>
          ) : null,
        )}
      </dl>
    </SiteFrame>
  );
};

export default LegalNotice;
