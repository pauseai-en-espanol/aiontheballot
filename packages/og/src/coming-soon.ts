import { palette } from '@aiontheballot/ui/brand';

import { h, type OgNode } from './node.js';
import { SHARE_SIZES, type ShareSize } from './sizes.js';

/** What the coming-soon card shows. Every text comes from the tenant's data and the i18n messages. */
export interface ComingSoonCard {
  /** "Próximamente", or the next election's name and date when there is one. */
  label: string;
  /** The tenant's name: the product people share. */
  name: string;
  question: string;
  /** The tenant's canonical address without the scheme (BRIEF §3, invariant 4: large on every card). */
  address: string;
  /** "Una iniciativa de {operator}": the operator's mark, as text until tenants have logos. */
  initiative: string;
}

interface Layout {
  /** Padding; stories keep their top and bottom clear for the apps' own controls. */
  pad: number;
  padTop: number;
  padBottom: number;
  nameMax: number;
  question: number;
  label: number;
  address: number;
  small: number;
  ballot: number;
  /** Whether the address and the operator line sit side by side. */
  wide: boolean;
}

const LAYOUTS: Record<ShareSize, Layout> = {
  '1200x630': {
    pad: 56,
    padTop: 48,
    padBottom: 48,
    nameMax: 150,
    question: 34,
    label: 24,
    address: 46,
    small: 22,
    ballot: 270,
    wide: true,
  },
  '1080x1080': {
    pad: 72,
    padTop: 72,
    padBottom: 72,
    nameMax: 176,
    question: 48,
    label: 28,
    address: 56,
    small: 26,
    ballot: 300,
    wide: false,
  },
  '1080x1350': {
    pad: 80,
    padTop: 88,
    padBottom: 88,
    nameMax: 190,
    question: 54,
    label: 30,
    address: 60,
    small: 28,
    ballot: 320,
    wide: false,
  },
  '1080x1920': {
    pad: 88,
    padTop: 220,
    padBottom: 270,
    nameMax: 200,
    question: 60,
    label: 32,
    address: 62,
    small: 30,
    ballot: 330,
    wide: false,
  },
};

/** Saira Condensed's capitals average under half an em; a margin keeps estimates on the safe side. */
const EM_PER_CHAR = 0.5;

/** The ballot beside the first line takes about this many characters of its width. */
const BALLOT_CHARS = 4;

/**
 * The name on two lines, balanced, counting the ballot beside the first one: "IA en" / "las urnas". One word stays
 * one line.
 */
export const nameLines = (name: string): [string] | [string, string] => {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) {
    return [words[0] ?? ''];
  }
  let best: [string, string] = [words.slice(0, 1).join(' '), words.slice(1).join(' ')];
  for (let i = 1; i < words.length; i += 1) {
    const candidate: [string, string] = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    const worse = (pair: [string, string]) =>
      Math.max(pair[0].length + BALLOT_CHARS, pair[1].length);
    if (
      worse(candidate) < worse(best) ||
      (worse(candidate) === worse(best) && candidate[0].length < best[0].length)
    ) {
      best = candidate;
    }
  }
  return best;
};

const display = {
  fontFamily: 'Saira Condensed',
  fontWeight: 700,
  textTransform: 'uppercase',
} as const;

/** A ballot going into the slot of a ballot box, as on the page. */
const ballot = (width: number): OgNode => {
  const u = width / 440;
  const row = (checked: boolean, barWidth: number, faded: boolean) =>
    h(
      'div',
      { display: 'flex', alignItems: 'center', gap: 12 * u },
      h(
        'div',
        {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 20 * u,
          height: 20 * u,
          border: `${3 * u}px solid ${palette.ink}`,
        },
        checked
          ? h('div', { width: 8 * u, height: 8 * u, backgroundColor: palette.ink })
          : h('div', { width: 0, height: 0 }),
      ),
      h('div', {
        width: barWidth * u,
        height: 6 * u,
        backgroundColor: palette.ink,
        opacity: faded ? 0.35 : 1,
      }),
    );
  return h(
    'div',
    { display: 'flex', position: 'relative', width, height: 190 * u, flexShrink: 0 },
    h(
      'div',
      {
        display: 'flex',
        flexDirection: 'column',
        gap: 14 * u,
        position: 'absolute',
        left: 79 * u,
        top: 0,
        width: 282 * u,
        height: 160 * u,
        padding: `${22 * u}px ${24 * u}px`,
        backgroundColor: palette.paper,
      },
      row(true, 202, false),
      row(false, 202, true),
      row(false, 110, true),
    ),
    h('div', {
      position: 'absolute',
      left: 0,
      bottom: 0,
      width,
      height: 44 * u,
      borderRadius: 22 * u,
      backgroundColor: palette.ink,
    }),
  );
};

/**
 * The coming-soon card in direction A (the orange poster): the label, the name as big as the space allows with the
 * ballot beside its first line, the question, then the address large and the operator small.
 */
export const comingSoonCard = (card: ComingSoonCard, size: ShareSize): OgNode => {
  const { width, height } = SHARE_SIZES[size];
  const l = LAYOUTS[size];
  const inner = width - 2 * l.pad;
  const lines = nameLines(card.name);
  const [first, second] = lines;
  // As big as the layout allows, but every line must fit: the first one beside the ballot.
  const nameSize = Math.floor(
    Math.min(
      l.nameMax,
      (inner - l.ballot - 32) / Math.max(1, first.length * EM_PER_CHAR),
      second === undefined ? l.nameMax : inner / Math.max(1, second.length * EM_PER_CHAR),
    ),
  );
  const nameLine = (text: string) =>
    h('div', { display: 'flex', fontSize: nameSize, lineHeight: 0.86, letterSpacing: -0.5 }, text);

  return h(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      width,
      height,
      padding: `${l.padTop}px ${l.pad}px ${l.padBottom}px`,
      backgroundColor: palette.orange,
      color: palette.ink,
      fontFamily: 'Roboto Slab',
    },
    // The label, with the pause sign.
    h(
      'div',
      {
        ...display,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: l.label,
        letterSpacing: 2,
      },
      h(
        'div',
        { display: 'flex', gap: 5 },
        h('div', { width: l.label * 0.28, height: l.label * 0.9, backgroundColor: palette.ink }),
        h('div', { width: l.label * 0.28, height: l.label * 0.9, backgroundColor: palette.ink }),
      ),
      card.label,
    ),
    h(
      'div',
      { display: 'flex', flexDirection: 'column', gap: l.question * 0.7 },
      h(
        'div',
        { ...display, display: 'flex', flexDirection: 'column' },
        h(
          'div',
          { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 32 },
          nameLine(first),
          ballot(l.ballot),
        ),
        ...(second === undefined ? [] : [nameLine(second)]),
      ),
      h(
        'div',
        {
          ...display,
          display: 'flex',
          fontSize: l.question,
          lineHeight: 1.08,
          maxWidth: inner * 0.9,
        },
        card.question,
      ),
    ),
    h(
      'div',
      {
        display: 'flex',
        flexDirection: l.wide ? 'row' : 'column',
        alignItems: l.wide ? 'flex-end' : 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        borderTop: `${Math.round(l.small / 6)}px solid ${palette.ink}`,
        paddingTop: l.small * 0.8,
      },
      h(
        'div',
        { display: 'flex', fontFamily: 'Saira Condensed', fontWeight: 700, fontSize: l.address },
        card.address,
      ),
      h('div', { display: 'flex', fontSize: l.small }, card.initiative),
    ),
  );
};
