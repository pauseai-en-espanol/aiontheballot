/**
 * The words of a site's own paths (public-site spec §3). A site's paths use the words of its default locale, in every
 * locale, so a page's locales differ only by the prefix (`/generales-2026/partidos/x`, `/en/generales-2026/partidos/x`).
 * The public app's routes use the English words; the routing proxy maps a site's words onto them, and an English word
 * on a site that uses others is no page at all, so each page keeps one address.
 */

/** The words, by what they name. Tenant-level words are first path segments; the others follow an election's slug. */
export const SITE_WORDS = {
  en: {
    legalNotice: 'legal-notice',
    privacy: 'privacy',
    about: 'about',
    updates: 'updates',
    confirm: 'confirm',
    unsubscribe: 'unsubscribe',
    parties: 'parties',
    criteria: 'criteria',
    methodology: 'methodology',
    report: 'report',
    send: 'send',
    corrections: 'corrections',
  },
  es: {
    legalNotice: 'aviso-legal',
    privacy: 'privacidad',
    about: 'quienes-somos',
    updates: 'avisos',
    confirm: 'confirmar',
    unsubscribe: 'baja',
    parties: 'partidos',
    criteria: 'criterios',
    methodology: 'metodologia',
    report: 'informar',
    send: 'enviar',
    corrections: 'correcciones',
  },
} as const satisfies Record<string, Record<string, string>>;

export type SiteWord = keyof (typeof SITE_WORDS)['en'];

/** First path segments under a tenant's root that name its own pages. */
export const TENANT_LEVEL_WORDS = ['legalNotice', 'privacy', 'about', 'updates'] as const;
/** What follows `updates`. */
const UPDATES_WORDS = ['confirm', 'unsubscribe'] as const;
/** What follows an election's slug. */
const ELECTION_WORDS = ['parties', 'criteria', 'methodology', 'report', 'corrections'] as const;
/** What follows `report`: where its form posts. */
const REPORT_WORDS = ['send'] as const;

/** The words a site uses: its default locale's, or English for a language without its own. */
export const siteWords = (defaultLocale: string): Readonly<Record<SiteWord, string>> =>
  (SITE_WORDS as Readonly<Record<string, Readonly<Record<SiteWord, string>>>>)[defaultLocale] ??
  SITE_WORDS.en;

/** Every tenant-level word of every language: no election may take one as its slug (PLAN R76). */
export const TENANT_LEVEL_SEGMENTS: readonly string[] = [
  ...new Set(
    Object.values(SITE_WORDS).flatMap((words) => TENANT_LEVEL_WORDS.map((key) => words[key])),
  ),
].sort();

const toInternal = (
  segment: string,
  keys: readonly SiteWord[],
  words: Readonly<Record<SiteWord, string>>,
): string | null | undefined => {
  for (const key of keys) {
    if (segment === words[key]) {
      return SITE_WORDS.en[key];
    }
    // The app's own word, on a site whose word differs: no page.
    if (segment === SITE_WORDS.en[key]) {
      return null;
    }
  }
  return undefined;
};

/**
 * Maps a path under a tenant's root, in its site's words, onto the app's routes (English words). Returns undefined
 * when the path uses an English word the site doesn't (a 404). Other segments (election, party and criterion slugs,
 * and the paths the site serves itself, such as `/brand/…`) pass through.
 */
export const toInternalPath = (defaultLocale: string, path: string): string | undefined => {
  const words = siteWords(defaultLocale);
  const segments = path.split('/');
  // segments[0] is the empty string before the leading slash.
  const first = segments[1];
  if (first === undefined || first === '') {
    return path;
  }
  const tenantLevel = toInternal(first, TENANT_LEVEL_WORDS, words);
  if (tenantLevel === null) {
    return undefined;
  }
  if (tenantLevel !== undefined) {
    segments[1] = tenantLevel;
    if (tenantLevel === SITE_WORDS.en.updates && segments[2] !== undefined) {
      const next = toInternal(segments[2], UPDATES_WORDS, words);
      if (next === null) {
        return undefined;
      }
      segments[2] = next ?? segments[2];
    }
    return segments.join('/');
  }
  // An election's slug, then its own words.
  if (segments[2] !== undefined) {
    const next = toInternal(segments[2], ELECTION_WORDS, words);
    if (next === null) {
      return undefined;
    }
    segments[2] = next ?? segments[2];
    if (next === SITE_WORDS.en.report && segments[3] !== undefined) {
      const after = toInternal(segments[3], REPORT_WORDS, words);
      if (after === null) {
        return undefined;
      }
      segments[3] = after ?? segments[3];
    }
  }
  return segments.join('/');
};

/** The pages a site links to, by name and parameters. */
export type SitePage =
  | { page: 'home' }
  | { page: 'legalNotice' | 'privacy' | 'about' | 'updates' }
  | { page: 'confirm' | 'unsubscribe' }
  | { page: 'election'; election: string }
  | { page: 'methodology'; election: string }
  | { page: 'party'; election: string; party: string }
  | { page: 'cell'; election: string; party: string; criterion: string }
  | { page: 'criterion'; election: string; criterion: string }
  /** The right-of-reply form, and where it posts (PLAN R149). */
  | { page: 'report' | 'reportSend'; election: string }
  /** The election's public corrections log (PLAN R150). */
  | { page: 'corrections'; election: string };

/**
 * A page's path under the tenant's root, in its site's words, without the locale prefix: `/aviso-legal`,
 * `/generales-2026/partidos/x`. Slugs are lowercase words and hyphens, so they need no escaping.
 */
export const sitePath = (defaultLocale: string, target: SitePage): string => {
  const w = siteWords(defaultLocale);
  switch (target.page) {
    case 'home':
      return '/';
    case 'legalNotice':
    case 'privacy':
    case 'about':
    case 'updates':
      return `/${w[target.page]}`;
    case 'confirm':
    case 'unsubscribe':
      return `/${w.updates}/${w[target.page]}`;
    case 'election':
      return `/${target.election}`;
    case 'methodology':
      return `/${target.election}/${w.methodology}`;
    case 'party':
      return `/${target.election}/${w.parties}/${target.party}`;
    case 'cell':
      return `/${target.election}/${w.parties}/${target.party}/${target.criterion}`;
    case 'criterion':
      return `/${target.election}/${w.criteria}/${target.criterion}`;
    case 'report':
      return `/${target.election}/${w.report}`;
    case 'reportSend':
      return `/${target.election}/${w.report}/${w.send}`;
    case 'corrections':
      return `/${target.election}/${w.corrections}`;
    default:
      return '/';
  }
};
