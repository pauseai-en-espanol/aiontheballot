import type { RatingDisplay } from '@aiontheballot/ui/ratings';
import type { ReactNode } from 'react';

import { css, cx } from '@styled-system/css';

import { focusRing } from '../styles';
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
 * An election's summary (PLAN R218; the chapter's first look at the demo asked for "a summary table with icons, no
 * words, and a legend below"): every party's rating on every criterion as its icon alone, in columns narrow enough for
 * a whole election on one screen, the criteria's short titles standing upright over them. A rating is never its colour
 * alone (BRIEF §6): each icon's shape says it, the legend right under the table gives every icon's words, each cell's
 * words are its link's name for screen readers and its tooltip, and each cell opens its page. A real table, with its
 * headers' scopes and a caption. On a wide screen it takes the page's width, its columns shared out evenly, so a short
 * election doesn't sit in a corner; on a phone each column keeps its icon's width and the table scrolls sideways
 * inside its own region, the party column fixed.
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
}) => (
  <div
    role="region"
    aria-label={regionLabel}
    // A region that scrolls must take the keyboard's focus, so it can be scrolled without a mouse (WCAG 2.1.1).
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    tabIndex={0}
    data-summary=""
    className={cx(focusRing, css({ overflowX: 'auto', maxWidth: '100%' }))}
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
            className={css({
              position: 'sticky',
              insetInlineStart: '0',
              zIndex: '1',
              bg: 'bg.canvas',
              textAlign: 'start',
              verticalAlign: 'bottom',
              paddingBlock: '10px',
              paddingInlineEnd: '12px',
              borderBottom: '3px solid',
              borderColor: 'border.default',
              fontSize: '15px',
              // The fixed layout's party column; the criteria share the rest.
              width: { lg: '11rem' },
            })}
          >
            {partyHeader}
          </th>
          {criteria.map((criterion) => (
            <th
              key={criterion.id}
              scope="col"
              className={css({
                verticalAlign: 'bottom',
                textAlign: 'center',
                paddingBlockEnd: '10px',
                paddingInline: '2px',
                borderBottom: '3px solid',
                borderColor: 'border.default',
              })}
            >
              {/* Upright, read from the bottom up, over the middle of its icons, wrapping onto a second line rather
                  than ever being cut; no underline, which would stand beside the letters as a stray line, until pointed
                  at. */}
              <a
                href={criterion.href}
                lang={criterion.title.lang}
                className={cx(
                  focusRing,
                  css({
                    _hover: { textDecoration: 'underline', textUnderlineOffset: '3px' },
                    display: 'inline-block',
                    writingMode: 'vertical-rl',
                    transform: 'rotate(180deg)',
                    maxHeight: '13rem',
                    fontSize: '15px',
                    fontWeight: '600',
                    lineHeight: '1.15',
                    textAlign: 'start',
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
              className={css({
                position: 'sticky',
                insetInlineStart: '0',
                zIndex: '1',
                bg: 'bg.canvas',
                textAlign: 'start',
                paddingInlineEnd: '12px',
                borderBottom: '1px solid',
                borderColor: 'border.subtle',
                whiteSpace: 'nowrap',
              })}
            >
              <a
                href={party.href}
                className={cx(
                  link,
                  css({ display: 'inline-flex', alignItems: 'center', gap: '8px' }),
                )}
              >
                {party.mark}
                <abbr
                  title={party.full.text}
                  lang={party.short.lang}
                  className={css({ textDecoration: 'none' })}
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
                    // On two short lines rather than widening the party column.
                    whiteSpace: 'normal',
                    maxWidth: '9rem',
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
                      // A ring around the icon under the pointer, and a thicker one for the keyboard, both inside the
                      // cell, where the fixed party column never covers them.
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
);
