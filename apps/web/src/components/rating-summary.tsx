import type { RatingDisplay } from '@aiontheballot/ui/ratings';
import type { CSSProperties, ReactNode } from 'react';

import { css, cx } from '@styled-system/css';

import { focusRing } from '../styles';
import { tiltedHeaderRoom } from '../tilted-headers';
import { RatingIcon } from './rating';

/** Text in the language it is in (local-text.ts). */
interface InLanguage {
  text: string;
  lang: string;
}

export interface SummaryParty {
  id: string;
  href: string;
  short: InLanguage;
  full: InLanguage;
  /** Its mark (PartyMark), when the election's parties have them. */
  mark?: ReactNode;
  /** Whether its mark is its logo, which then stands for its name on a phone (PLAN R242). */
  logo?: boolean;
  /**
   * A short note under its name, the long one its tooltip: that its programme isn't published yet, which says why its
   * ratings are pending (public-site spec §5).
   */
  note?: { text: string; title: string };
}

export interface SummaryCriterion {
  id: string;
  href: string;
  title: InLanguage;
}

export interface SummaryCell {
  href: string;
  rating: RatingDisplay;
  /** The rating's words: the link's name for screen readers. */
  label: string;
  /** "PEA · Criterio: Cumple", the words a pointer shows. */
  title: string;
}

const link = cx(focusRing, css({ textDecoration: 'underline', textUnderlineOffset: '3px' }));

/** Each cell's link: a round target of at least 24 px (WCAG 2.5.8), the icon in the middle. */
const cellSide = css({
  width: { base: '38px', md: '44px' },
  height: { base: '38px', md: '44px' },
  borderRadius: 'full',
});

/**
 * On a phone, a party with a logo goes by its logo alone, the party column then as narrow as its header, so more
 * criteria fit beside it; its name stays for screen readers, and is in sight again from a tablet up (PLAN R242). A
 * party without one keeps its name: a colour isn't enough to tell parties apart.
 */
const logoOnly = (party: SummaryParty) => Boolean(party.mark) && party.logo === true;
const nameFromTablet = css({ display: { base: 'none', md: 'inline' } });
const nameForScreenReadersOnPhone = css({ srOnly: true, display: { md: 'none' } });

/**
 * That the summary scrolls sideways (PLAN R242): a shadow at the region's end while there is more to see, covered by
 * the table's own end as it scrolls in (a background that stays put under one that scrolls with the table: no script,
 * every browser), and none when it all fits.
 */
const moreToTheEnd = css({
  backgroundImage:
    'linear-gradient(to left, {colors.bg.canvas} 40%, transparent), linear-gradient(to left, color-mix(in srgb, {colors.fg.default} 25%, transparent), transparent)',
  backgroundPosition: 'right center, right center',
  backgroundSize: '40px 100%, 16px 100%',
  backgroundRepeat: 'no-repeat',
  backgroundAttachment: 'local, scroll',
});

/**
 * The party column, fixed at the start while the criteria scroll under it, and a shadow along it once they do (PLAN
 * R242), brought in by the scroll where the browser runs animations on scrolling; elsewhere, the icons cut at its edge
 * say it.
 */
const fixedColumn = css({
  position: 'sticky',
  insetInlineStart: '0',
  zIndex: '1',
  bg: 'bg.canvas',
  _after: {
    content: '""',
    position: 'absolute',
    insetBlock: '0',
    insetInlineStart: '100%',
    width: '12px',
    backgroundImage:
      'linear-gradient(to right, color-mix(in srgb, {colors.fg.default} 25%, transparent), transparent)',
    pointerEvents: 'none',
    opacity: '0',
  },
  '@supports (animation-timeline: scroll())': {
    _after: {
      animationName: 'scrollReveal',
      // Any length: on a scroll timeline it spans the range below (some browsers ignore a zero or `auto`).
      animationDuration: '1ms',
      animationTimingFunction: 'linear',
      animationFillMode: 'both',
      animationTimeline: 'scroll(nearest inline)',
      animationRange: '0 24px',
    },
  },
});

/**
 * An election's summary (PLAN R218; the chapter's first look at the demo asked for "a summary table with icons, no
 * words, and a legend below"): every party's rating on every criterion as its icon alone, in columns narrow enough for
 * a whole election on one screen, the criteria's short titles over them tilted at 45°, rising to the right from the
 * middle of their column, so they read without turning the head (PLAN R225). A rating is never its colour alone
 * (BRIEF §6): each icon's shape says it, the legend right under the table gives every icon's words, each cell's words
 * are its link's name for screen readers and its tooltip, and each cell opens its page. A real table, with its
 * headers' scopes and a caption. On a wide screen it takes the page's width, its columns shared out evenly, so a short
 * election doesn't sit in a corner; on a phone each column keeps its icon's width and the table scrolls sideways
 * inside its own region, the party column fixed, a shadow at either edge where there is more (PLAN R242). A title is
 * never cut: the header row is as tall as the longest one rises, and the table leaves free at its end as much as any
 * reaches past its last column (`tiltedHeaderRoom`).
 */
export const RatingSummary = ({
  caption,
  regionLabel,
  partyHeader,
  parties,
  criteria,
  cells,
}: {
  caption: ReactNode;
  /** "La tabla resumen, que se desplaza en horizontal". */
  regionLabel: string;
  partyHeader: string;
  parties: readonly SummaryParty[];
  criteria: readonly SummaryCriterion[];
  /** By party, then by criterion, in the same orders. */
  cells: readonly (readonly SummaryCell[])[];
}) => {
  const room = tiltedHeaderRoom(criteria.map((criterion) => criterion.title.text));
  // Inline, as numbers: the styles below are extracted at build time and read them as variables.
  const tilt = { '--tilt-rise': room.rise, '--tilt-overhang': room.overhang } as CSSProperties;
  return (
    <div
      role="region"
      aria-label={regionLabel}
      // A region that scrolls must take the keyboard's focus, so it can be scrolled without a mouse (WCAG 2.1.1).
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      data-summary=""
      style={tilt}
      className={cx(focusRing, moreToTheEnd, css({ overflowX: 'auto', maxWidth: '100%' }))}
    >
      {/* The table and, past its last column, the room its last titles reach into; in the region, so it scrolls
          with them on a phone, and the table takes the rest of the width on a wide screen. */}
      <div
        className={css({
          // The titles' size, for their `ch` (tilted-headers.ts); a tenth more for their weight.
          fontSize: '15px',
          width: { base: 'max-content', lg: 'auto' },
          paddingInlineEnd: 'calc(var(--tilt-overhang) * 1.1ch)',
        })}
      >
        <table
          className={css({
            borderCollapse: 'separate',
            borderSpacing: '0',
            fontSize: '16px',
            width: { base: 'auto', lg: '100%' },
            tableLayout: { base: 'auto', lg: 'fixed' },
            // A row lights up under the pointer, its party's name included, so a rating is easy to follow across.
            '& tbody tr:hover > *': { bg: 'bg.subtle' },
          })}
        >
          <caption className={css({ srOnly: true })}>{caption}</caption>
          <thead>
            <tr>
              <th
                scope="col"
                className={cx(
                  fixedColumn,
                  css({
                    textAlign: 'start',
                    verticalAlign: 'bottom',
                    paddingBlock: '10px',
                    paddingInlineEnd: '12px',
                    borderBottom: '3px solid',
                    borderColor: 'border.default',
                    fontSize: '15px',
                    // The fixed layout's party column; the criteria share the rest.
                    width: { lg: '11rem' },
                  }),
                )}
              >
                {partyHeader}
              </th>
              {criteria.map((criterion) => (
                <th
                  key={criterion.id}
                  scope="col"
                  className={css({
                    // The titles' type, which their `ch` measures (tilted-headers.ts).
                    fontSize: '15px',
                    fontWeight: '600',
                    position: 'relative',
                    // As tall as the longest title rises at 45°, with its line's own slant and a margin.
                    height: 'calc(var(--tilt-rise) * 1ch + 30px)',
                    padding: '0',
                    borderBottom: '3px solid',
                    borderColor: 'border.default',
                  })}
                >
                  {/* Tilted at 45°, rising to the right from the middle of its icons, on one line; no underline,
                      which would run beside the letters as a stray slanted line, until pointed at. */}
                  <a
                    href={criterion.href}
                    lang={criterion.title.lang}
                    className={cx(
                      focusRing,
                      css({
                        _hover: { textDecoration: 'underline', textUnderlineOffset: '3px' },
                        position: 'absolute',
                        insetInlineStart: 'calc(50% - 0.3em)',
                        bottom: '10px',
                        transformOrigin: '0 100%',
                        transform: 'rotate(-45deg)',
                        whiteSpace: 'nowrap',
                        lineHeight: '1.15',
                      }),
                    )}
                  >
                    {criterion.title.text}
                  </a>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {parties.map((party, row) => (
              <tr key={party.id}>
                <th
                  scope="row"
                  className={cx(
                    fixedColumn,
                    css({
                      textAlign: 'start',
                      paddingInlineEnd: '12px',
                      borderBottom: '1px solid',
                      borderColor: 'border.subtle',
                      whiteSpace: 'nowrap',
                    }),
                  )}
                >
                  <a
                    href={party.href}
                    className={cx(
                      link,
                      css({ display: 'inline-flex', alignItems: 'center', gap: '8px' }),
                    )}
                  >
                    {party.mark}
                    {logoOnly(party) && (
                      <span lang={party.short.lang} className={nameForScreenReadersOnPhone}>
                        {party.short.text}
                      </span>
                    )}
                    <abbr
                      title={party.full.text}
                      lang={party.short.lang}
                      className={cx(
                        css({ textDecoration: 'none' }),
                        logoOnly(party) && nameFromTablet,
                      )}
                    >
                      {party.short.text}
                    </abbr>
                    {/* The full name for screen readers, which seldom read a title (spec §5.1). */}
                    {party.full.text !== party.short.text && (
                      <span lang={party.full.lang} className={css({ srOnly: true })}>
                        {`(${party.full.text})`}
                      </span>
                    )}
                  </a>
                  {party.note && (
                    <span
                      title={party.note.title}
                      className={css({
                        display: 'block',
                        fontSize: '13px',
                        color: 'fg.muted',
                        fontWeight: '400',
                        lineHeight: '1.3',
                        paddingBlockEnd: '4px',
                        // On short lines rather than widening the party column, narrow under a logo alone.
                        whiteSpace: 'normal',
                        maxWidth: { base: '5.5rem', md: '9rem' },
                      })}
                    >
                      {party.note.text}
                    </span>
                  )}
                </th>
                {criteria.map((criterion, column) => {
                  const cell = cells[row]?.[column];
                  return (
                    <td
                      key={criterion.id}
                      className={css({
                        padding: '0',
                        textAlign: 'center',
                        borderBottom: '1px solid',
                        borderColor: 'border.subtle',
                      })}
                    >
                      {cell && (
                        <a
                          href={cell.href}
                          title={cell.title}
                          data-rating={cell.rating}
                          // A ring around the icon under the pointer, and a thicker one for the keyboard, both inside
                          // the cell, where the fixed party column never covers them.
                          className={cx(
                            cellSide,
                            css({
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              marginInline: 'auto',
                              _hover: { boxShadow: 'inset 0 0 0 2px {colors.border.default}' },
                              _focusVisible: {
                                outline: '3px solid',
                                outlineColor: 'currentColor',
                                outlineOffset: '-3px',
                              },
                            }),
                          )}
                        >
                          <RatingIcon rating={cell.rating} size={26} />
                          <span className={css({ srOnly: true })}>{cell.label}</span>
                        </a>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
