import { describe, expect, it } from 'vitest';

import { ADD_FIELDS, UPDATE_FIELDS } from './fields';
import { proposalProblems } from './problems';

const TEXT = {
  problems: {
    required: 'required',
    localized: 'localized',
    confirm: 'confirm',
    choose: 'choose',
    email: 'email',
    url: 'url',
    https: 'https',
    slug: 'slug',
    whole: 'from {min} to {max}',
    invalid: 'invalid',
  },
  defaultLanguage: 'in {language} too',
  kindsNeeded: 'kinds',
  constraints: { parties_website_check: 'website', parties_colour_check: 'colour' },
};
const LOCALES = [
  { code: 'es', label: 'español', required: true },
  { code: 'en', label: 'inglés', required: false },
];
const NOTE = { es: 'Nota de ejemplo', en: '' };

describe("a change request's checks before sending (admin forms §1.2, PLAN R189)", () => {
  it('passes a new party with every value it needs', () => {
    expect(
      proposalProblems(
        {
          slug: 'partido-ejemplo-c',
          name: { es: 'Partido Ejemplo C' },
          short_name: { es: 'PEC' },
          colour: null,
          website: null,
          territory_codes: null,
        },
        ADD_FIELDS.party ?? {},
        NOTE,
        LOCALES,
        TEXT,
      ),
    ).toEqual({});
  });

  it('names each value missing or misshapen, and a note with no words', () => {
    expect(
      proposalProblems(
        {
          slug: 'Partido C',
          name: {},
          short_name: { en: 'EPC' },
          colour: '#12',
          website: 'ejemplo.org',
        },
        ADD_FIELDS.party ?? {},
        { es: ' ', en: '' },
        LOCALES,
        TEXT,
      ),
    ).toEqual({
      slug: 'slug',
      name: 'localized',
      short_name: 'in español too',
      colour: 'colour',
      website: 'website',
      publicNote: 'localized',
    });
  });

  it("asks for a reviewer's name but not their affiliation, and a whole number for a place", () => {
    const fields = UPDATE_FIELDS.methodology_reviewer;
    expect(proposalProblems({ name: '', affiliation: '' }, fields, NOTE, LOCALES, TEXT)).toEqual({
      name: 'required',
    });
    expect(proposalProblems({ display_order: 2.5 }, fields, NOTE, LOCALES, TEXT)).toEqual({
      display_order: 'from 0 to 10000',
    });
    expect(proposalProblems({ display_order: null }, fields, NOTE, LOCALES, TEXT)).toEqual({
      display_order: 'required',
    });
  });

  it('wants one source kind at least, and checks only the values it sends', () => {
    expect(
      proposalProblems(
        { admissible_source_kinds: [] },
        UPDATE_FIELDS.methodology,
        NOTE,
        LOCALES,
        TEXT,
      ),
    ).toEqual({ admissible_source_kinds: 'kinds' });
    expect(proposalProblems({}, UPDATE_FIELDS.methodology, NOTE, LOCALES, TEXT)).toEqual({});
  });
});
