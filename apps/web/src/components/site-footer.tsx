import type { PublicHome } from '@aiontheballot/domain/public-home';

import { pickLocalized } from '@aiontheballot/domain/localized';
import { getTranslator, isLocale, type Locale, LOCALE_NAMES } from '@aiontheballot/i18n/messages';
import { css, cx } from '@styled-system/css';

export interface SiteLinks {
  legalNotice: string;
  /** Only once the operator has published the text. */
  privacy?: string | undefined;
  about?: string | undefined;
  /** The election's methodology, on its pages (BRIEF §3 invariant 2). */
  methodology?: string | undefined;
  /** The election's corrections log, on its pages (BRIEF §4; PLAN R150). */
  corrections?: string | undefined;
}

export interface LanguageLink {
  locale: string;
  href: string;
}

interface SiteFooterProps {
  home: PublicHome;
  locale: Locale;
  /** The operator's logo for a light background, as an image URL, when the tenant has uploaded it. */
  logo: string | undefined;
  links: SiteLinks;
  /** The same page in each of the site's languages; shown when there is more than one. */
  languages: readonly LanguageLink[];
}

const focusRing = css({
  _focusVisible: { outline: '3px solid', outlineColor: 'currentColor', outlineOffset: '3px' },
});

/**
 * Every public page's footer, which no tenant setting can change (BRIEF §3, invariants 1 and 3): "An initiative of
 * {operator}" linking to the operator's site, in words or with its logo; the contact address; the legal notice, the
 * privacy policy and the page about the operator; and the language switch.
 */
export const SiteFooter = ({ home, locale, logo, links, languages }: SiteFooterProps) => {
  const t = getTranslator(locale);
  const operator =
    pickLocalized(home.operator.displayName, locale, home.tenant.defaultLocale) ?? '';
  const operatorUrl = home.operator.url;
  const line = logo ? (
    <span className={css({ display: 'inline-flex', alignItems: 'center', gap: '12px' })}>
      <span>{t('layout.initiativeLead')}</span>
      {/* A plain img: a small logo the brand route serves once, cached for a year; nothing for next/image to do. */}
      {/* oxlint-disable-next-line next/no-img-element */}
      <img
        src={logo}
        alt={operator}
        className={css({ display: 'block', height: '40px', width: 'auto' })}
      />
    </span>
  ) : (
    t('layout.initiativeOf', { operator })
  );
  const pages = [
    ...(links.methodology ? [{ href: links.methodology, label: t('layout.methodology') }] : []),
    ...(links.corrections ? [{ href: links.corrections, label: t('layout.corrections') }] : []),
    ...(links.about ? [{ href: links.about, label: t('layout.about') }] : []),
    { href: links.legalNotice, label: t('layout.legalNotice') },
    ...(links.privacy ? [{ href: links.privacy, label: t('layout.privacy') }] : []),
  ];
  return (
    <footer className={css({ bg: 'bg.canvas', color: 'fg.default' })}>
      <div
        className={css({
          width: '100%',
          maxWidth: '1200px',
          marginInline: 'auto',
          paddingInline: 'clamp(16px, 4vw, 56px)',
          paddingBlock: '40px',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
          fontSize: '16px',
          '& a': { textDecoration: 'underline', textUnderlineOffset: '3px' },
        })}
      >
        <div
          className={css({
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px 48px',
          })}
        >
          <p data-invariant="operator-line">
            {operatorUrl ? (
              <a className={focusRing} href={operatorUrl}>
                {line}
              </a>
            ) : (
              line
            )}
          </p>
          {home.operator.contactEmail && (
            <p>
              {t('layout.contact')}:{' '}
              <a className={focusRing} href={`mailto:${home.operator.contactEmail}`}>
                {home.operator.contactEmail}
              </a>
            </p>
          )}
        </div>
        <nav aria-label={t('layout.siteLinks')}>
          <ul
            className={css({
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px 24px',
              listStyle: 'none',
            })}
          >
            {pages.map(({ href, label }) => (
              <li key={href}>
                <a className={focusRing} href={href}>
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        {languages.length > 1 && (
          <nav aria-label={t('layout.language')}>
            <ul
              className={css({
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px 24px',
                listStyle: 'none',
              })}
            >
              {languages.map(({ locale: other, href }) => (
                <li key={other} lang={other}>
                  {other === locale ? (
                    <span aria-current="page" className={cx(css({ fontWeight: '700' }))}>
                      {isLocale(other) ? LOCALE_NAMES[other] : other}{' '}
                      <span lang={locale}>{t('layout.currentLanguage')}</span>
                    </span>
                  ) : (
                    <a className={focusRing} href={href} hrefLang={other}>
                      {isLocale(other) ? LOCALE_NAMES[other] : other}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </footer>
  );
};
