import type { Problems, ProblemText } from '../ui/checks';
import type { LocaleOption } from '../ui/LocalizedField';
import type { FieldKind } from './fields';

import { COLOUR } from '../ui/colour';

/** What a proposal's checks say, beyond the shared words. */
export interface ProposalProblemText {
  problems: ProblemText;
  /** A public text without the site's main language: with `{language}`. */
  defaultLanguage: string;
  /** A list of source kinds left empty. */
  kindsNeeded: string;
  /** The constraints' own words, where one fits (a slug, a website, a colour). */
  constraints: Readonly<Record<string, string>>;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const URL = /^https?:\/\/\S+$/u;

/**
 * What a change request's form can tell before sending (admin forms §1.2): each value it sends, by its field's kind, as
 * `valueOf` reads it, and the public note, keyed by column (and `publicNote`). A public text needs words, and the
 * site's main language among them (CR1.6); plain text a value, but a reviewer's affiliation; a slug, a website and a
 * colour their shape; a place in the list a whole number; a list of source kinds one at least. The API and the
 * database check it all again.
 */
export const proposalProblems = (
  values: Readonly<Record<string, unknown>>,
  fields: Readonly<Record<string, FieldKind>>,
  publicNote: Readonly<Record<string, string>>,
  locales: readonly LocaleOption[],
  text: ProposalProblemText,
): Problems<string> => {
  const found: Problems<string> = {};
  const main = locales.find((locale) => locale.required);
  const localized = (value: unknown): string | undefined => {
    const filled = Object.entries((value ?? {}) as Record<string, unknown>).filter(
      ([, words]) => typeof words === 'string' && words.trim() !== '',
    );
    if (filled.length === 0) {
      return text.problems.localized;
    }
    return main && !filled.some(([code]) => code === main.code)
      ? text.defaultLanguage.replace('{language}', main.name ?? main.label)
      : undefined;
  };
  for (const [name, value] of Object.entries(values)) {
    const kind = fields[name] ?? 'text';
    let problem: string | undefined;
    if (kind === 'localized' || kind === 'localizedLong') {
      problem = localized(value);
    } else if (kind === 'text') {
      const words = typeof value === 'string' ? value : '';
      if (words === '') {
        problem = name === 'affiliation' ? undefined : text.problems.required;
      } else if (name === 'slug' && (!SLUG.test(words) || words.length > 63)) {
        problem = text.constraints.slug_check ?? text.problems.slug;
      }
    } else if (kind === 'url') {
      problem =
        typeof value === 'string' && !URL.test(value)
          ? (text.constraints.parties_website_check ?? text.problems.url)
          : undefined;
    } else if (kind === 'colour') {
      problem =
        typeof value === 'string' && !COLOUR.test(value)
          ? (text.constraints.parties_colour_check ?? text.problems.invalid)
          : undefined;
    } else if (kind === 'number') {
      problem =
        typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10_000
          ? undefined
          : value === null
            ? text.problems.required
            : text.problems.whole.replace('{min}', '0').replace('{max}', '10000');
    } else if (kind === 'sourceKinds') {
      problem = Array.isArray(value) && value.length > 0 ? undefined : text.kindsNeeded;
    }
    if (problem !== undefined) {
      found[name] = problem;
    }
  }
  const note = localized(publicNote);
  if (note !== undefined) {
    found.publicNote = note;
  }
  return found;
};
