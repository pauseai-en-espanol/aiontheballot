import type { PublicHome } from '@aiontheballot/domain/public-home';
import type { Locale } from '@aiontheballot/i18n/catalog';

import { pickLocalized } from '@aiontheballot/domain/localized';
import { getTranslator } from '@aiontheballot/i18n/messages';
import { css, cx } from '@styled-system/css';

interface ComingSoonProps {
  home: PublicHome;
  locale: Locale;
}

const wrap = css({
  width: '100%',
  maxWidth: '1200px',
  marginInline: 'auto',
  paddingInline: 'clamp(16px, 4vw, 56px)',
});

const display = css({ fontFamily: 'display', fontWeight: '700', textTransform: 'uppercase' });

const focusRing = css({
  _focusVisible: { outline: '3px solid', outlineColor: 'currentColor', outlineOffset: '3px' },
});

const button = cx(
  display,
  css({
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: '52px',
    paddingInline: '24px',
    fontSize: '22px',
    letterSpacing: '0.02em',
    textDecoration: 'none',
    bg: 'bg.inverse',
    color: 'fg.inverse',
    _hover: { color: 'fg.accentOnInverse' },
    // Ink on the orange page, not the button's own white, which the orange would wash out.
    _focusVisible: { outline: '3px solid', outlineColor: 'border.default', outlineOffset: '3px' },
  }),
);

/** The pause sign: two bars, as in PauseAI's mark. Decorative. */
const PauseBars = () => (
  <span aria-hidden="true" className={css({ display: 'inline-flex', gap: '4px' })}>
    {[0, 1].map((bar) => (
      <span key={bar} className={css({ width: '6px', height: '20px', bg: 'currentColor' })} />
    ))}
  </span>
);

// No inline styles: the cached public site's CSP has no nonces (ADR-0003).
const BALLOT_ROWS = [
  { checked: true, line: css({ flex: '1', height: '6px', bg: 'fg.default' }) },
  { checked: false, line: css({ flex: '1', height: '6px', bg: 'fg.default', opacity: '0.35' }) },
  { checked: false, line: css({ width: '55%', height: '6px', bg: 'fg.default', opacity: '0.35' }) },
];

/** A ballot going into the slot of a ballot box. Decorative, and only where there is room beside the name. */
const Ballot = () => (
  <span
    aria-hidden="true"
    className={css({
      display: { base: 'none', md: 'block' },
      float: 'right',
      position: 'relative',
      width: 'clamp(200px, 32vw, 440px)',
      height: 'clamp(120px, 14vw, 190px)',
      marginInlineStart: '40px',
    })}
  >
    <span
      className={css({
        position: 'absolute',
        insetInline: '18%',
        top: '0',
        bottom: '30px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        paddingBlock: '22px',
        paddingInline: '24px',
        bg: 'bg.canvas',
      })}
    >
      {BALLOT_ROWS.map(({ checked, line }, row) => (
        <span key={row} className={css({ display: 'flex', alignItems: 'center', gap: '12px' })}>
          <span
            className={css({
              display: 'grid',
              placeItems: 'center',
              flex: 'none',
              width: '20px',
              height: '20px',
              border: '3px solid',
              borderColor: 'border.default',
            })}
          >
            {checked && <span className={css({ width: '8px', height: '8px', bg: 'fg.default' })} />}
          </span>
          <span className={line} />
        </span>
      ))}
    </span>
    <span
      className={css({
        position: 'absolute',
        insetInline: '0',
        bottom: '0',
        height: '44px',
        borderRadius: '22px',
        bg: 'bg.inverse',
      })}
    />
  </span>
);

const PROMISES = ['quotes', 'history', 'corrections'] as const;

/**
 * A tenant's home until its site goes public (PLAN M3, coming soon): the tenant's name, what the site will do, the
 * next public election if there is one, and how the operator works. Every name, link and date comes from the data.
 */
export const ComingSoon = ({ home, locale }: ComingSoonProps) => {
  const t = getTranslator(locale);
  const local = (value: PublicHome['tenant']['displayName']) =>
    pickLocalized(value, locale, home.tenant.defaultLocale) ?? '';
  const operator = local(home.operator.displayName);
  const operatorUrl = home.operator.url;
  const { election } = home;
  const electionName = election ? local(election.name) : '';

  return (
    <div
      lang={locale}
      className={css({
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100dvh',
        bg: 'bg.accent',
        color: 'fg.onAccent',
      })}
    >
      <header
        className={cx(
          wrap,
          css({
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px 24px',
            paddingBlock: '28px',
          }),
        )}
      >
        <p
          className={cx(
            display,
            css({
              display: 'inline-flex',
              alignItems: 'center',
              gap: '10px',
              fontSize: '20px',
              letterSpacing: '0.08em',
            }),
          )}
        >
          <PauseBars />
          {t('home.comingSoon')}
        </p>
        <p className={css({ fontSize: '16px' })}>{t('layout.initiativeOf', { operator })}</p>
      </header>

      <main className={css({ flex: '1' })}>
        <section className={cx(wrap, css({ paddingBlock: '24px 88px' }))}>
          <h1
            className={cx(
              display,
              css({
                fontSize: 'clamp(56px, 18vw, 232px)',
                lineHeight: '0.84',
                letterSpacing: '-0.005em',
                // Balanced wrapping (the preflight's default for headings) ignores the ballot's float in Chrome
                // and runs the name off the page.
                textWrap: 'wrap',
                // A word too long for the line breaks rather than overflow; no hyphens, which look broken this big.
                overflowWrap: 'break-word',
              }),
            )}
          >
            <Ballot />
            {local(home.tenant.displayName)}
          </h1>

          <div
            className={css({
              clear: 'both',
              display: 'grid',
              gridTemplateColumns: { base: '1fr', md: '1fr 1fr' },
              gap: '40px 64px',
              alignItems: 'end',
              marginTop: '48px',
            })}
          >
            <div className={css({ display: 'flex', flexDirection: 'column', gap: '16px' })}>
              <p
                className={cx(
                  display,
                  css({
                    fontSize: 'clamp(28px, 2.8vw, 38px)',
                    lineHeight: '1.05',
                    textWrap: 'balance',
                  }),
                )}
              >
                {t('home.question')}
              </p>
              <p
                className={css({
                  fontSize: 'clamp(18px, 1.6vw, 21px)',
                  lineHeight: '1.5',
                  maxWidth: '38ch',
                  textWrap: 'pretty',
                })}
              >
                {t(`home.description.${home.tenant.methodologyKind}`, { operator })}
              </p>
            </div>

            {(election !== null || operatorUrl !== null) && (
              <div
                className={css({
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: '20px',
                })}
              >
                {election && (
                  <p
                    className={cx(
                      display,
                      css({
                        fontSize: '22px',
                        letterSpacing: '0.04em',
                        borderTop: '3px solid',
                        borderColor: 'border.default',
                        paddingTop: '14px',
                      }),
                    )}
                  >
                    {election.date
                      ? t('home.election', {
                          name: electionName,
                          date: new Date(`${election.date}T12:00:00Z`),
                        })
                      : electionName}
                  </p>
                )}
                {operatorUrl && (
                  <a className={button} href={operatorUrl}>
                    {t('home.learnMore', { operator })}
                  </a>
                )}
              </div>
            )}
          </div>
        </section>

        <section
          aria-labelledby="how"
          className={css({ bg: 'bg.inverse', color: 'fg.inverse', paddingBlock: '88px' })}
        >
          <div className={cx(wrap, css({ display: 'flex', flexDirection: 'column', gap: '48px' }))}>
            <h2
              id="how"
              className={cx(
                display,
                css({
                  fontSize: 'clamp(36px, 4vw, 52px)',
                  lineHeight: '1',
                  color: 'fg.accentOnInverse',
                }),
              )}
            >
              {t('home.how.title')}
            </h2>
            <ol
              className={css({
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))',
                gap: '48px',
                listStyle: 'none',
              })}
            >
              {PROMISES.map((key, index) => (
                <li
                  key={key}
                  className={css({
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '14px',
                    borderTop: '3px solid',
                    borderColor: 'fg.accentOnInverse',
                    paddingTop: '22px',
                  })}
                >
                  <span
                    aria-hidden="true"
                    className={css({
                      fontFamily: 'numeric',
                      fontWeight: '900',
                      fontSize: '22px',
                      color: 'fg.accentOnInverse',
                    })}
                  >
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <h3 className={cx(display, css({ fontSize: '34px', lineHeight: '1' }))}>
                    {t(`home.how.${key}.title`)}
                  </h3>
                  <p
                    className={css({
                      fontSize: '18px',
                      lineHeight: '1.55',
                      color: 'fg.inverseMuted',
                      textWrap: 'pretty',
                    })}
                  >
                    {t(`home.how.${key}.body`)}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>

      <footer className={css({ bg: 'bg.canvas', color: 'fg.default' })}>
        <div
          className={cx(
            wrap,
            css({
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px 48px',
              paddingBlock: '40px',
              fontSize: '16px',
              '& a': { textDecoration: 'underline', textUnderlineOffset: '3px' },
            }),
          )}
        >
          <p>
            {operatorUrl ? (
              <a className={focusRing} href={operatorUrl}>
                {t('layout.initiativeOf', { operator })}
              </a>
            ) : (
              t('layout.initiativeOf', { operator })
            )}
          </p>
          {home.operator.contactEmail && (
            <p>
              {t('home.contact')}:{' '}
              <a className={focusRing} href={`mailto:${home.operator.contactEmail}`}>
                {home.operator.contactEmail}
              </a>
            </p>
          )}
        </div>
      </footer>
    </div>
  );
};
