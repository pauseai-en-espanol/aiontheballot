import type { PropsWithChildren, ReactNode } from 'react';

import { getTranslator } from '@aiontheballot/i18n/messages';
import { css } from '@styled-system/css';

import type { LoadedElectionPage } from '../election-page';

import { localText } from '../local-text';
import { focusRing, pageTitle } from '../styles';
import { SiteFrame } from './site-frame';

interface ElectionFrameProps {
  page: LoadedElectionPage;
  target: Parameters<LoadedElectionPage['languages']>[0];
  title: ReactNode;
  /** The pages between the election and this one, for the breadcrumb. */
  trail?: { href: string; label: ReactNode }[];
}

/**
 * The frame of an election's pages (public-site spec §5): the shared layout, with the election's methodology in the
 * footer (BRIEF §3 invariant 2), a breadcrumb back to the scorecard, and the page's title.
 */
export const ElectionFrame = ({
  page,
  target,
  title,
  trail = [],
  children,
}: PropsWithChildren<ElectionFrameProps>) => {
  const t = getTranslator(page.locale);
  const { election } = page.election;
  const name = localText(election.name, page.locale, page.page.home.tenant.defaultLocale);
  const methodology = page.href({ page: 'methodology', election: election.slug });
  const crumbs = [
    { href: page.href({ page: 'election', election: election.slug }), label: name.text },
    ...trail,
  ];
  return (
    <SiteFrame site={page} target={target} links={{ methodology }}>
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
      {children}
    </SiteFrame>
  );
};
