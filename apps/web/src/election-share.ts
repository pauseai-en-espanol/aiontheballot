import type {
  PublicCriterion,
  PublicElection,
  PublicParty,
} from '@aiontheballot/domain/public-election';
import type { PublicHome } from '@aiontheballot/domain/public-home';
import type {
  CardParty,
  CriterionCard,
  DataRow,
  OverviewCard,
  PartyCard,
  TableCard,
} from '@aiontheballot/og/data-cards';
import type {
  CardFrame,
  CellCard,
  CorrectionsCard,
  LegendEntry,
  MethodologyCard,
} from '@aiontheballot/og/election-cards';
import type { TemplateName } from '@aiontheballot/og/templates';

import { pickLocalized } from '@aiontheballot/domain/localized';
import { RATING_SCALES } from '@aiontheballot/domain/methodology';
import { getTranslator, type Locale } from '@aiontheballot/i18n/messages';
import { cardHash } from '@aiontheballot/og/hash';
import { isShareSize, type ShareSize } from '@aiontheballot/og/sizes';
import { cardTheme } from '@aiontheballot/og/theme';

import { correctionsLog } from './corrections-log';
import { type CellView, cellViews, methodologyOf } from './election-view';
import { localText } from './local-text';
import { ratingLabel } from './rating-label';
import { accentLogo } from './share';
import { pageCanonical } from './site';

/**
 * The share images of an election's pages (PLAN, social sharing; R148): each view's card content, from the site's
 * public data and the messages, its content hash, and its address. The cards are drawn by packages/og.
 */

/** An election's page that has a card of its own. */
export type ElectionView =
  | { view: 'overview' }
  /** The whole table as one picture, to download from the scorecard: never a page's link preview (R162). */
  | { view: 'table' }
  | { view: 'methodology' }
  | { view: 'corrections' }
  | { view: 'party'; party: string }
  | { view: 'criterion'; criterion: string }
  | { view: 'cell'; party: string; criterion: string };

/** What an election's cards are made from: the site's data and the election's. */
export interface ElectionShareData {
  home: PublicHome;
  /** The site's canonical base, `https://host` or `https://host/{slug}`. */
  base: string;
  locale: Locale;
  election: PublicElection;
}

export type ElectionCardContent =
  | { template: 'overview'; card: OverviewCard }
  | { template: 'party'; card: PartyCard }
  | { template: 'criterion'; card: CriterionCard }
  | { template: 'cell'; card: CellCard }
  | { template: 'methodology'; card: MethodologyCard }
  | { template: 'corrections'; card: CorrectionsCard }
  | { template: 'table'; card: TableCard };

/** The sizes the table is offered in: posted pictures' shapes. A link preview's is too low for a whole table. */
export const TABLE_SIZES: readonly ShareSize[] = ['1080x1080', '1080x1350', '1080x1920'];

export interface ElectionCard {
  content: ElectionCardContent;
  /** The image in words, for its alt text: what it rates and how, never only that it is an image. */
  alt: string;
  /** The page's title, as its tab and its link preview give it: what a share link says before the address (R177). */
  text: string;
}

/** Where an election view's image lives, under the page's locale root: `/{election}/og/party/{slug}/{size}.{hash}.png`. */
export const electionImagePath = (
  election: string,
  view: ElectionView,
  size: ShareSize,
  hash: string,
): string => {
  const keys =
    view.view === 'party'
      ? [view.party]
      : view.view === 'criterion'
        ? [view.criterion]
        : view.view === 'cell'
          ? [view.party, view.criterion]
          : [];
  return `/${election}/og/${[view.view, ...keys].join('/')}/${size}.${hash}.png`;
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The view, size and hash an image path under `/{election}/og/` names, or nothing for anything else. */
export const parseElectionImagePath = (
  segments: readonly string[],
): { view: ElectionView; size: ShareSize; hash: string } | undefined => {
  const file = segments.at(-1) ?? '';
  const [, size, hash] = /^(\d+x\d+)\.([0-9a-f]{12})\.png$/.exec(file) ?? [];
  const keys = segments.slice(1, -1);
  if (!isShareSize(size) || !hash || !keys.every((key) => SLUG.test(key))) {
    return undefined;
  }
  const [kind] = segments;
  const view: ElectionView | undefined =
    (kind === 'overview' || kind === 'methodology' || kind === 'corrections') && keys.length === 0
      ? { view: kind }
      : kind === 'table' && keys.length === 0 && TABLE_SIZES.includes(size)
        ? { view: 'table' }
        : kind === 'party' && keys.length === 1
          ? { view: 'party', party: keys[0] as string }
          : kind === 'criterion' && keys.length === 1
            ? { view: 'criterion', criterion: keys[0] as string }
            : kind === 'cell' && keys.length === 2
              ? { view: 'cell', party: keys[0] as string, criterion: keys[1] as string }
              : undefined;
  return view ? { view, size, hash } : undefined;
};

/** The image's content hash: it changes whenever anything on the card does, or the way the card is drawn. */
export const electionCardHash = (content: ElectionCardContent, size: ShareSize): string =>
  cardHash(content.template as TemplateName, size, content.card);

/** Every view of the election: the overview, the methodology, each party, criterion and cell. */
export const electionViews = (election: PublicElection): ElectionView[] => [
  { view: 'overview' },
  { view: 'methodology' },
  { view: 'corrections' },
  ...election.parties.map((party): ElectionView => ({ view: 'party', party: party.slug })),
  ...election.criteria.map((criterion): ElectionView => ({
    view: 'criterion',
    criterion: criterion.slug,
  })),
  ...election.parties.flatMap((party) =>
    election.criteria.map((criterion): ElectionView => ({
      view: 'cell',
      party: party.slug,
      criterion: criterion.slug,
    })),
  ),
];

/** The newest of some cells' current revisions' dates. */
const newest = (cells: CellView[]): string | undefined =>
  cells
    .map((cell) => cell.history[0]?.publishedAt)
    .filter((date): date is string => date !== undefined)
    .sort()
    .at(-1);

/** A logo a card can draw: satori draws PNG and JPEG, so a WebP one leaves the name alone. */
const drawable = (logo: { sha256: string; contentType: string } | null | undefined) =>
  logo && ['image/png', 'image/jpeg'].includes(logo.contentType)
    ? { sha256: logo.sha256, contentType: logo.contentType }
    : undefined;

/** The card for a view, or nothing for a party or criterion the election doesn't have. */
export const electionCard = (
  { home, base, locale, election }: ElectionShareData,
  view: ElectionView,
): ElectionCard | undefined => {
  const t = getTranslator(locale);
  const defaultLocale = home.tenant.defaultLocale;
  const text = (value: Parameters<typeof localText>[0]) =>
    localText(value, locale, defaultLocale).text;
  const local = (value: Parameters<typeof pickLocalized>[0]) =>
    pickLocalized(value, locale, defaultLocale) ?? '';
  const address = base.replace(/^https:\/\//, '');
  const slug = election.election.slug;
  const name = text(election.election.name);
  const { kind, owner } = methodologyOf(election, home.tenant.methodologyKind);
  const cell = cellViews(election);
  const operatorLogo = drawable(accentLogo(home));
  const site = local(home.tenant.displayName);
  const updated = (date: string | undefined) =>
    date ? { updated: t('election.updated', { date: new Date(date) }) } : {};
  const frame: CardFrame = {
    // The site's own accent (PLAN R178); the ratings' colours never change.
    theme: cardTheme(home.tenant.theme ?? {}),
    site,
    election: election.election.date
      ? t('home.election', { name, date: new Date(`${election.election.date}T12:00:00Z`) })
      : name,
    address,
    methodology: t('share.methodology', {
      address: pageCanonical(base, locale, defaultLocale, {
        page: 'methodology',
        election: slug,
      }).replace(/^https:\/\//, ''),
    }),
    initiative: t('layout.initiativeOf', { operator: local(home.operator.displayName) }),
    initiativeLead: t('layout.initiativeLead'),
    ...(operatorLogo ? { operatorLogo } : {}),
  };
  const legend = (): LegendEntry[] =>
    [...RATING_SCALES[kind], 'pending' as const].map((rating) => ({
      rating,
      label: ratingLabel(locale, rating),
    }));
  const row = (label: string, view: CellView): DataRow => ({
    label,
    rating: view.display,
    ratingLabel: ratingLabel(locale, view.display),
  });
  const ratings = (rows: DataRow[]) =>
    rows
      .map((entry) => t('share.alt.rating', { label: entry.label, rating: entry.ratingLabel }))
      .join('; ');
  const more = t('share.more', { count: '#' });
  const findParty = (partySlug: string): PublicParty | undefined =>
    election.parties.find((party) => party.slug === partySlug);
  const findCriterion = (criterionSlug: string): PublicCriterion | undefined =>
    election.criteria.find((criterion) => criterion.slug === criterionSlug);
  const shortTitle = (criterion: PublicCriterion) => text(criterion.shortTitle ?? criterion.title);
  const ownerName = owner ? local(owner.name) : undefined;
  // As pageMetadata titles the page: its own words, then the site's name.
  const titled = (words: string) => `${words} · ${site}`;
  // The data cards' date (PLAN R185): the newest rating they show, or that none is published yet.
  const dataDate = (views: CellView[]) => {
    const date = newest(views);
    return { dataDate: date ? t('share.dataDate', { date: new Date(date) }) : t('share.noData') };
  };
  /** A party as the data cards name it, with its colour (PLAN R184). */
  const cardParty = (party: PublicParty): CardParty => ({
    short: text(party.shortName),
    name: text(party.name),
    colour: party.colour,
  });
  const scorecardQuestion =
    kind === 'descriptive'
      ? t('election.question.descriptive')
      : ownerName
        ? t('election.question.demands', { owner: ownerName })
        : t('election.question.demandsUnnamed');

  switch (view.view) {
    case 'overview':
    case 'table': {
      // Every party's rating on every criterion (PLAN R185): the link preview (canvas A) and the whole table (B), each
      // with its data's date, parties in the site's order, never ranked or totalled.
      const views = election.parties.map((party) =>
        election.criteria.map((criterion) => cell(party, criterion)),
      );
      const parties = election.parties.map(cardParty);
      const partyLogos = election.parties.map((party) => drawable(party.logo) ?? null);
      const shared = {
        ...frame,
        ...dataDate(views.flat()),
        title: scorecardQuestion,
        parties,
        ...(partyLogos.some(Boolean) ? { partyLogos } : {}),
        criteria: election.criteria.map(shortTitle),
        legend: legend(),
      };
      const names = parties.map((party) => party.short).join(', ');
      return view.view === 'overview'
        ? {
            content: {
              template: 'overview',
              card: {
                ...shared,
                subtitle: t('share.overviewSubtitle', {
                  election: name,
                  count: election.criteria.length,
                }),
                cells: views.map((rowViews) => rowViews.map((one) => one.display)),
                more,
              },
            },
            alt: t('share.alt.overview', { site, question: scorecardQuestion, parties: names }),
            text: titled(name),
          }
        : {
            content: {
              template: 'table',
              card: {
                ...shared,
                subtitle: t('share.tableSubtitle', { election: name }),
                cells: views.map((rowViews) =>
                  rowViews.map((one) => ({
                    rating: one.display,
                    label: ratingLabel(locale, one.display),
                  })),
                ),
              },
            },
            alt: t('share.alt.table', { site, question: scorecardQuestion, parties: names }),
            text: titled(name),
          };
    }
    case 'methodology': {
      const lead =
        kind === 'descriptive'
          ? t('methodologyPage.descriptive')
          : ownerName
            ? t('methodologyPage.demands', { owner: ownerName })
            : t('methodologyPage.demandsUnnamed');
      return {
        content: {
          template: 'methodology',
          card: { ...frame, kicker: t('methodologyPage.title'), title: lead, legend: legend() },
        },
        alt: `${t('methodologyPage.title')}: ${lead}`,
        text: titled(t('methodologyPage.title')),
      };
    }
    case 'corrections': {
      const entries = correctionsLog(election);
      const [latest] = entries;
      const summary = latest
        ? t('correctionsPage.summary', { count: entries.length, date: new Date(latest.at) })
        : t('correctionsPage.summaryNone');
      return {
        content: {
          template: 'corrections',
          card: { ...frame, kicker: t('correctionsPage.title'), title: name, summary },
        },
        alt: `${t('correctionsPage.title')}, ${name}: ${summary}`,
        text: titled(t('correctionsPage.title')),
      };
    }
    case 'party': {
      const party = findParty(view.party);
      if (!party) {
        return undefined;
      }
      const views = election.criteria.map((criterion) => cell(party, criterion));
      const rows = election.criteria.map((criterion, i) =>
        row(text(criterion.title), views[i] as CellView),
      );
      const title = text(party.name);
      const partyLogo = drawable(party.logo);
      return {
        content: {
          template: 'party',
          card: {
            ...frame,
            ...dataDate(views),
            question:
              kind === 'descriptive'
                ? t('share.partyQuestion.descriptive')
                : ownerName
                  ? t('share.partyQuestion.demands', { owner: ownerName })
                  : t('share.partyQuestion.demandsUnnamed'),
            party: cardParty(party),
            rows,
            more,
            ...(partyLogo ? { partyLogo } : {}),
          },
        },
        alt: t('share.alt.rows', { title, ratings: ratings(rows) }),
        text: titled(title),
      };
    }
    case 'criterion': {
      const criterion = findCriterion(view.criterion);
      if (!criterion) {
        return undefined;
      }
      const views = election.parties.map((party) => cell(party, criterion));
      const partyLogos = election.parties.map((party) => drawable(party.logo) ?? null);
      const rows = election.parties.map((party, i) => ({
        ...row(text(party.shortName), views[i] as CellView),
        party: cardParty(party),
      }));
      const title = text(criterion.title);
      return {
        content: {
          template: 'criterion',
          card: {
            ...frame,
            ...dataDate(views),
            kicker: t('share.criterionOf', {
              number: election.criteria.indexOf(criterion) + 1,
              count: election.criteria.length,
            }),
            title,
            description: text(criterion.description),
            rows,
            more,
            ...(partyLogos.some(Boolean) ? { partyLogos } : {}),
          },
        },
        alt: t('share.alt.rows', { title, ratings: ratings(rows) }),
        text: titled(title),
      };
    }
    case 'cell': {
      const party = findParty(view.party);
      const criterion = findCriterion(view.criterion);
      if (!party || !criterion) {
        return undefined;
      }
      const shown = cell(party, criterion);
      const partyName = text(party.name);
      const criterionTitle = text(criterion.title);
      const rating = ratingLabel(locale, shown.display);
      const summary = shown.current?.summary ? text(shown.current.summary) : undefined;
      const [evidence] = shown.current?.evidence ?? [];
      const partyLogo = drawable(party.logo);
      return {
        content: {
          template: 'cell',
          card: {
            ...frame,
            ...updated(shown.current?.publishedAt),
            party: partyName,
            criterion: criterionTitle,
            rating: shown.display,
            ratingLabel: rating,
            ...(summary ? { summary } : {}),
            ...(evidence ? { source: t('share.source', { title: evidence.source.title }) } : {}),
            ...(partyLogo ? { partyLogo } : {}),
            ...(party.colour ? { partyColour: party.colour } : {}),
          },
        },
        alt: t('share.alt.cell', { party: partyName, criterion: criterionTitle, rating }),
        text: titled(
          t('cellPage.title', { party: text(party.shortName), criterion: criterionTitle }),
        ),
      };
    }
  }
};
