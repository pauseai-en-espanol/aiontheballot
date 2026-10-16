import type { PropsWithChildren } from 'react';

import { pickLocalized } from '@aiontheballot/domain/localized';
import { getTranslator } from '@aiontheballot/i18n/messages';
import { siteColourVariables } from '@aiontheballot/ui/site-colours';
import { css, cx } from '@styled-system/css';

import type { LoadedSitePage } from '../site-page';

import { FOOTER_LOGO } from '../site-page';
import { display, focusRing, wrap } from '../styles';
import { SiteFooter, type SiteLinks } from './site-footer';

interface SiteFrameProps {
  site: LoadedSitePage;
  /** The page shown, for the language switch. */
  target: Parameters<LoadedSitePage['languages']>[0];
  /** A query the page needs in every language (a token page's `?t=`), kept by the language switch. */
  query?: string | undefined;
  /** More footer links than the site's own: the methodology, on an election's pages. */
  links?: Partial<SiteLinks>;
}

/**
 * The shared layout of a site's pages (public-site spec §4), which no tenant setting changes: a skip link, the site's
 * name linking home, the page, and the footer with the operator line and the legal links. Only its colours are the
 * site's own (PLAN R178): its root sets the accent's variables, which every page under it draws with.
 */
export const SiteFrame = ({
  site,
  target,
  links,
  query,
  children,
}: PropsWithChildren<SiteFrameProps>) => {
  const { page, locale, href } = site;
  const { home } = page;
  const t = getTranslator(locale);
  const name = pickLocalized(home.tenant.displayName, locale, home.tenant.defaultLocale) ?? '';
  return (
    <div
      lang={locale}
      style={siteColourVariables(home.tenant.theme ?? {})}
      className={css({
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100dvh',
        bg: 'bg.canvas',
        color: 'fg.default',
      })}
    >
      <a
        href="#contenido"
        className={css({
          position: 'absolute',
          insetInlineStart: '16px',
          top: '-100px',
          zIndex: '1',
          padding: '12px 16px',
          bg: 'bg.inverse',
          color: 'fg.inverse',
          // Over the header, so in the accent's line colour.
          _focusVisible: { top: '16px', outline: '3px solid', outlineColor: 'border.onAccent' },
        })}
      >
        {t('layout.skipToContent')}
      </a>
      <header className={css({ bg: 'bg.accent', color: 'fg.onAccent' })}>
        <div className={cx(wrap, css({ paddingBlock: '20px' }))}>
          <a
            href={href({ page: 'home' })}
            className={cx(display, focusRing, css({ fontSize: '26px', letterSpacing: '0.02em' }))}
          >
            {name}
          </a>
        </div>
      </header>
      <main
        id="contenido"
        className={cx(wrap, css({ flex: '1', paddingBlock: 'clamp(32px, 6vh, 64px)' }))}
      >
        {children}
      </main>
      <SiteFooter
        home={home}
        locale={locale}
        logo={site.logo(FOOTER_LOGO)}
        links={{ ...site.links, ...links }}
        languages={site
          .languages(target)
          .map((language) =>
            query ? { ...language, href: `${language.href}?${query}` } : language,
          )}
      />
    </div>
  );
};
