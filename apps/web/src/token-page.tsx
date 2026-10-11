import { pickLocalized } from '@aiontheballot/domain/localized';
import { getTranslator } from '@aiontheballot/i18n/messages';
import { css } from '@styled-system/css';

import type { TokenPage, TokenPageProps } from './token-metadata';

import { SiteFrame } from './components/site-frame';
import { loadSitePage } from './site-page';
import { pageTitle } from './styles';

const one = (value: string | string[] | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined;

/**
 * The page an email's link opens (public-site spec §6): one button that posts the token back, so following a link
 * (or a mail scanner's fetch) never confirms or unsubscribes anything. The answer comes back as `?r=`, without the
 * token.
 */
export const TokenPageView = async ({
  props,
  page,
}: {
  props: TokenPageProps;
  page: TokenPage;
}) => {
  const loaded = await loadSitePage(props);
  const { locale, href } = loaded;
  const { home } = loaded.page;
  const t = getTranslator(locale);
  const site = pickLocalized(home.tenant.displayName, locale, home.tenant.defaultLocale) ?? '';
  const query = await props.searchParams;
  const token = one(query.t);
  const result = one(query.r);
  const message =
    result === 'ok'
      ? t(`${page}.done`, { site })
      : result === 'invalid'
        ? t(`${page}.invalid`)
        : result === 'failed'
          ? t('errors.unexpected')
          : token === undefined || !/^[\w-]{43}$/u.test(token)
            ? t(`${page}.missing`)
            : undefined;
  return (
    <SiteFrame
      site={loaded}
      target={{ page }}
      // The token stays with the page in another language, until it is used.
      query={token && !result ? new URLSearchParams({ t: token }).toString() : undefined}
    >
      <h1 className={pageTitle}>{t(`${page}.title`)}</h1>
      {message ? (
        <div
          className={css({
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            maxWidth: '60ch',
          })}
        >
          <p role="status" className={css({ fontSize: '20px', fontWeight: '700' })}>
            {message}
          </p>
          {page === 'confirm' && result === 'ok' && (
            <p className={css({ fontSize: '17px' })}>{t('confirm.undo')}</p>
          )}
        </div>
      ) : (
        <form
          method="post"
          action={href({ page: 'updates' })}
          className={css({
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: '24px',
          })}
        >
          <p className={css({ fontSize: '19px', maxWidth: '60ch' })}>
            {t(`${page}.lead`, { site })}
          </p>
          <input type="hidden" name="action" value={page} />
          <input type="hidden" name="t" value={token} />
          <button
            type="submit"
            className={css({
              minHeight: '52px',
              paddingInline: '28px',
              fontFamily: 'display',
              fontWeight: '700',
              textTransform: 'uppercase',
              fontSize: '22px',
              bg: 'bg.inverse',
              color: 'fg.inverse',
              border: '3px solid',
              borderColor: 'border.default',
              cursor: 'pointer',
              _hover: { color: 'fg.accentOnInverse' },
              _focusVisible: {
                outline: '3px solid',
                outlineColor: 'border.default',
                outlineOffset: '3px',
              },
            })}
          >
            {t(`${page}.button`)}
          </button>
        </form>
      )}
    </SiteFrame>
  );
};
