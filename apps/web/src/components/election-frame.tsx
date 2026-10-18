import type { PropsWithChildren, ReactNode } from 'react';

import { getTranslator } from '@aiontheballot/i18n/messages';
import { css } from '@styled-system/css';

import type { PageShare } from '../election-images';
import type { LoadedElectionPage } from '../election-page';

import { localText } from '../local-text';
import { sharedUrl, shareLinks } from '../share-links';
import { pageCanonical } from '../site';
import { focusRing, pageTitle } from '../styles';
import { PageViews } from './page-views';
import { SharePanel } from './share-panel';
import { SiteFrame } from './site-frame';

interface ElectionFrameProps {
  page: LoadedElectionPage;
  target: Parameters<LoadedElectionPage['languages']>[0];
  title: ReactNode;
  /** A line that belongs to the title, right below it: the scorecard's date. */
  subtitle?: ReactNode;
  /** The pages between the election and this one, for the breadcrumb. */
  trail?: { href: string; label: ReactNode }[];
  /** The page's one "Share" panel below its title (PLAN R185): its data image first, then its link (R177). */
  share?: PageShare;
}

/** What a page's saved share images are named after, past the site and the election. */
const shareFileWords = (target: ElectionFrameProps['target']): string[] => {
  switch (target.page) {
    case 'party':
      return [target.party];
    case 'criterion':
      return [target.criterion];
    case 'cell':
      return [target.party, target.criterion];
    case 'methodology':
      return ['methodology'];
    case 'corrections':
      return ['corrections'];
    default:
      return [];
  }
};

/**
 * The frame of an election's pages (public-site spec §5): the shared layout, with the election's methodology in the
 * footer (BRIEF §3 invariant 2), a breadcrumb back to the scorecard, the page's title, and its page view.
 */
export const ElectionFrame = ({
  page,
  target,
  title,
  subtitle,
  trail = [],
  share,
  children,
}: PropsWithChildren<ElectionFrameProps>) => {
  const t = getTranslator(page.locale);
  const { election } = page.election;
  const defaultLocale = page.page.home.tenant.defaultLocale;
  const name = localText(election.name, page.locale, defaultLocale);
  // The canonical address, from the routing table: never the host this page was asked on (the preview's, a path's).
  const url = pageCanonical(page.page.base, page.locale, defaultLocale, target);
  const methodology = page.href({ page: 'methodology', election: election.slug });
  const corrections = page.href({ page: 'corrections', election: election.slug });
  const crumbs = [
    {
      href: page.href({ page: 'election', election: election.slug }),
      label: <span lang={name.lang}>{name.text}</span>,
    },
    ...trail,
  ];
  return (
    <SiteFrame site={page} target={target} links={{ methodology, corrections }}>
      {target.page !== 'election' && (
        <nav
          aria-label={t('election.breadcrumb')}
          className={css({ marginBottom: '16px', fontSize: '16px' })}
        >
          <ol
            className={css({
              display: 'flex',
              flexWrap: 'wrap',
              gap: '4px 8px',
              listStyle: 'none',
            })}
          >
            {crumbs.map(({ href, label }) => (
              <li key={href} className={css({ display: 'inline-flex', gap: '8px' })}>
                <a
                  href={href}
                  className={`${focusRing} ${css({ textDecoration: 'underline', textUnderlineOffset: '3px' })}`}
                >
                  {label}
                </a>
                <span aria-hidden="true">›</span>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <h1 className={pageTitle}>{title}</h1>
      {subtitle}
      {share && (
        <SharePanel
          links={shareLinks({ url: sharedUrl(url, share.preview.path), text: share.text })}
          url={sharedUrl(url, share.preview.path)}
          text={share.text}
          image={{
            alt: share.image.alt,
            downloads: share.image.downloads.map(({ size, href }) => ({
              size,
              href,
              fileName: `${[
                page.slug,
                election.slug,
                ...(share.image.table ? ['table'] : shareFileWords(target)),
              ].join('-')}-${size}.png`,
            })),
          }}
          words={{
            button: t('share.panel.button'),
            image: t('share.panel.image'),
            imageLead: t('share.panel.imageLead'),
            sizes: {
              '1080x1080': t('share.download.1080x1080'),
              '1080x1350': t('share.download.1080x1350'),
              '1080x1920': t('share.download.1080x1920'),
            },
            shareImage: t('share.panel.shareImage'),
            download: t('share.panel.download'),
            imageFailed: t('share.panel.imageFailed'),
            link: t('share.panel.link'),
            email: t('share.links.email'),
            native: t('share.links.native'),
            copy: t('share.links.copy'),
            copied: t('share.links.copied'),
            copyFailed: t('share.links.copyFailed'),
            newTab: t('share.links.newTab'),
          }}
        />
      )}
      {children}
      {target.page !== 'report' && (
        <p className={css({ marginTop: '40px', fontSize: '17px' })}>
          <a
            href={`${page.href({ page: 'report', election: election.slug })}${
              target.page === 'cell'
                ? `?${new URLSearchParams({ partido: target.party, criterio: target.criterion })}`
                : ''
            }`}
            className={`${focusRing} ${css({ textDecoration: 'underline', textUnderlineOffset: '3px' })}`}
          >
            {t('reportPage.link')}
          </a>
        </p>
      )}
      <PageViews />
    </SiteFrame>
  );
};
