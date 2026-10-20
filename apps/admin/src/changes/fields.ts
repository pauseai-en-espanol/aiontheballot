import type { ChangeTarget } from './data';

/**
 * How each change-controlled field is entered (editorial workflow CR1.2), as the database's change rules list them.
 * The methodology's demands owner and a criterion's core criterion change on their own screens' terms later. A party's
 * logo is an image, uploaded before the request names it (PLAN R183). Display order changes by number here: moving a
 * live election's rows is rare.
 */
export type FieldKind =
  | 'localized'
  | 'localizedLong'
  | 'text'
  | 'url'
  | 'date'
  | 'colour'
  | 'codes'
  | 'number'
  | 'sourceKinds'
  | 'logo';

export const UPDATE_FIELDS: Readonly<Record<ChangeTarget, Readonly<Record<string, FieldKind>>>> = {
  election: { name: 'localized', election_date: 'date', intro: 'localizedLong' },
  methodology: {
    body: 'localizedLong',
    admissible_source_kinds: 'sourceKinds',
    not_mentioned_source_kinds: 'sourceKinds',
  },
  methodology_reviewer: { name: 'text', affiliation: 'text', display_order: 'number' },
  party: {
    name: 'localized',
    short_name: 'localized',
    logo_file_id: 'logo',
    colour: 'colour',
    website: 'url',
    territory_codes: 'codes',
    display_order: 'number',
  },
  criterion: {
    title: 'localized',
    short_title: 'localized',
    description: 'localizedLong',
    display_order: 'number',
  },
};

/** What a new row of each kind is proposed with; its place in the list is the last (the API's). */
export const ADD_FIELDS: Readonly<
  Partial<Record<ChangeTarget, Readonly<Record<string, FieldKind>>>>
> = {
  // The slug after the name it follows (admin forms §1.5).
  party: {
    name: 'localized',
    short_name: 'localized',
    slug: 'text',
    colour: 'colour',
    website: 'url',
    territory_codes: 'codes',
  },
  criterion: {
    title: 'localized',
    short_title: 'localized',
    slug: 'text',
    description: 'localizedLong',
  },
  methodology_reviewer: { name: 'text', affiliation: 'text' },
};

/** Fields whose text is public and so needs the site's default language to be approved (CR1.6). */
export const isLocalized = (kind: FieldKind | undefined): boolean =>
  kind === 'localized' || kind === 'localizedLong';
