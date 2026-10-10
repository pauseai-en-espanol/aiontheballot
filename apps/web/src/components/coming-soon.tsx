import type { PublicHome } from '@aiontheballot/domain/public-home';
import type { Locale } from '@aiontheballot/i18n/catalog';

import { pickLocalized } from '@aiontheballot/domain/localized';
import { getTranslator } from '@aiontheballot/i18n/messages';
import { css, cx } from '@styled-system/css';

interface ComingSoonProps {
  home: PublicHome;
  locale: Locale;
  /** The operator's logo for each surface, as image URLs, when the tenant has uploaded them. */
  logos: { onAccent?: string; onCanvas?: string };
}

interface OperatorLineProps {
  logo: string | undefined;
  logoClass: string;
  lead: string;
  line: string;
  operator: string;
  url: string | null;
}

/** "Una iniciativa de" and the operator's logo for this surface, or the line in words; a link when there's a site. */
const OperatorLine = ({ logo, logoClass, lead, line, operator, url }: OperatorLineProps) => {
  const content = logo ? (
    <span className={css({ display: 'inline-flex', alignItems: 'center', gap: '12px' })}>
      <span>{lead}</span>
      {/* A plain img: a small logo the brand route serves once, cached for a year; nothing for next/image to do. */}
      {/* oxlint-disable-next-line next/no-img-element */}
      <img src={logo} alt={operator} className={logoClass} />
    </span>
  ) : (
    line
  );
  return url ? (
    <a className={focusRing} href={url}>
      {content}
    </a>
  ) : (
    content
  );
};

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

const buttonBase = cx(
  display,
  css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: { base: '100%', sm: 'auto' },
    minHeight: '52px',
    paddingInline: '24px',
    fontSize: { base: '20px', sm: '22px' },
    letterSpacing: '0.02em',
    textAlign: 'center',
    textDecoration: 'none',
    border: '3px solid',
    borderColor: 'border.default',
    // Ink on the orange page, not the solid button's own white, which the orange would wash out.
    _focusVisible: { outline: '3px solid', outlineColor: 'border.default', outlineOffset: '3px' },
  }),
);

const button = cx(
  buttonBase,
  css({ bg: 'bg.inverse', color: 'fg.inverse', _hover: { color: 'fg.accentOnInverse' } }),
);

const buttonOutline = cx(
  buttonBase,
  css({ color: 'fg.onAccent', _hover: { bg: 'bg.inverse', color: 'fg.inverse' } }),
);

/** The pause sign: two bars, as in PauseAI's mark. Decorative. */
const PauseBars = () => (
  <span aria-hidden="true" className={css({ display: 'inline-flex', gap: '4px' })}>
    {[0, 1].map((bar) => (
      <span key={bar} className={css({ width: '6px', height: '20px', bg: 'currentColor' })} />
    ))}
  </span>
);

/**
 * A ballot going into the slot of a ballot box, floated beside the start of the name. Decorative. An SVG, so it
 * scales down to a phone; no inline styles, since the cached public site's CSP has no nonces (ADR-0003).
 */
const Ballot = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 440 190"
    className={css({
      float: 'right',
      width: 'clamp(112px, min(34vw, 40vh), 440px)',
      height: 'auto',
      marginInlineStart: 'clamp(12px, 3vw, 40px)',
    })}
  >
    <rect x="79" y="0" width="282" height="160" className={css({ fill: 'bg.canvas' })} />
    {[22, 56, 90].map((y, row) => (
      <g key={y}>
        <rect
          x="104.5"
          y={y + 1.5}
          width="17"
          height="17"
          strokeWidth="3"
          className={css({ fill: 'none', stroke: 'border.default' })}
        />
        {row === 0 && (
          <rect x="110" y={y + 6} width="8" height="8" className={css({ fill: 'fg.default' })} />
        )}
        <rect
          x="135"
          y={y + 7}
          width={row === 2 ? 110 : 202}
          height="6"
          className={
            row === 0 ? css({ fill: 'fg.default' }) : css({ fill: 'fg.default', opacity: '0.35' })
          }
        />
      </g>
    ))}
    <rect x="0" y="146" width="440" height="44" rx="22" className={css({ fill: 'bg.inverse' })} />
  </svg>
);

// The name is a poster headline: as big as its longest word allows. A word never breaks (mid-word breaks look
// broken this big); at these sizes the longest word fits the narrowest page. The height caps it too, so on a laptop
// or a 1080p screen the rest of the page starts above the fold, and a rem term makes it grow with zoom (WCAG 1.4.4).
const NAME_SIZES = [
  {
    maxWord: 6,
    className: css({ fontSize: 'clamp(56px, calc(1.5rem + min(16vw, 15vh)), 232px)' }),
  },
  {
    maxWord: 9,
    className: css({ fontSize: 'clamp(44px, calc(1.25rem + min(11.5vw, 11.5vh)), 168px)' }),
  },
  { maxWord: 12, className: css({ fontSize: 'clamp(36px, calc(1rem + min(9vw, 9vh)), 128px)' }) },
  {
    maxWord: Infinity,
    className: css({ fontSize: 'clamp(28px, calc(0.75rem + min(5vw, 6vh)), 80px)' }),
  },
] as const;

const nameSize = (name: string): string => {
  const longest = Math.max(0, ...name.split(/\s+/).map((word) => word.length));
  return (NAME_SIZES.find((size) => longest <= size.maxWord) ?? NAME_SIZES[3]).className;
};

const PROMISES = ['quotes', 'history', 'corrections'] as const;

/**
 * A tenant's home until its site goes public (PLAN M3, coming soon): the tenant's name, what the site will do, the
 * next public election if there is one, and how the operator works. Every name, link and date comes from the data.
 */
export const ComingSoon = ({ home, locale, logos }: ComingSoonProps) => {
  const t = getTranslator(locale);
  const local = (value: PublicHome['tenant']['displayName']) =>
    pickLocalized(value, locale, home.tenant.defaultLocale) ?? '';
  const name = local(home.tenant.displayName);
  const operator = local(home.operator.displayName);
  const operatorUrl = home.operator.url;
  const { newsletterUrl } = home.operator;
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
        <p className={css({ fontSize: '16px' })}>
          <OperatorLine
            logo={logos.onAccent}
            logoClass={css({ display: 'block', height: '32px', width: 'auto' })}
            lead={t('layout.initiativeLead')}
            line={t('layout.initiativeOf', { operator })}
            operator={operator}
            url={logos.onAccent ? operatorUrl : null}
          />
        </p>
      </header>

      <main className={css({ flex: '1' })}>
        <section className={cx(wrap, css({ paddingBlock: '24px clamp(48px, 7vh, 88px)' }))}>
          <h1
            className={cx(
              display,
              nameSize(name),
              css({
                lineHeight: '0.84',
                letterSpacing: '-0.005em',
                // Balanced wrapping (the preflight's default for headings) ignores the ballot's float in Chrome
                // and runs the name off the page.
                textWrap: 'wrap',
              }),
            )}
          >
            <Ballot />
            {name}
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

            {(election !== null || operatorUrl !== null || newsletterUrl !== null) && (
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
                {(newsletterUrl ?? operatorUrl) && (
                  <div
                    className={css({
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '12px',
                      width: { base: '100%', sm: 'auto' },
                    })}
                  >
                    {newsletterUrl && (
                      <a className={button} href={newsletterUrl}>
                        {t('home.notify')}
                      </a>
                    )}
                    {operatorUrl && (
                      <a className={newsletterUrl ? buttonOutline : button} href={operatorUrl}>
                        {t('home.learnMore', { operator })}
                      </a>
                    )}
                  </div>
                )}
                {newsletterUrl && (
                  <p className={css({ fontSize: '15px' })}>{t('home.notifyNote', { operator })}</p>
                )}
              </div>
            )}
          </div>
        </section>

        <section
          aria-labelledby="how"
          className={css({
            bg: 'bg.inverse',
            color: 'fg.inverse',
            paddingBlock: 'clamp(56px, 8vh, 88px)',
          })}
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
            <OperatorLine
              logo={logos.onCanvas}
              logoClass={css({ display: 'block', height: '40px', width: 'auto' })}
              lead={t('layout.initiativeLead')}
              line={t('layout.initiativeOf', { operator })}
              operator={operator}
              url={operatorUrl}
            />
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
