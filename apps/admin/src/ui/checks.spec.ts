import { describe, expect, it } from 'vitest';

import { checkValues, constraintProblems, refusalProblem } from './checks';

const TEXT = {
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
};

describe("a form's checks before sending (admin forms §1.2, PLAN R189)", () => {
  it('names each field left empty that needs a value, and a box left unticked', () => {
    expect(
      checkValues(
        { name: '', note: '', consent: false, later: true },
        {
          name: { required: true },
          note: {},
          consent: { required: true },
          later: { required: true },
        },
        TEXT,
      ),
    ).toEqual({ name: 'required', consent: 'confirm' });
  });

  it('checks what a value looks like only when there is one', () => {
    const rules = {
      email: { shape: 'email' },
      site: { shape: 'url' },
      page: { shape: 'https' },
      slug: { shape: 'slug' },
    } as const;
    expect(checkValues({ email: '', site: '', page: '', slug: '' }, rules, TEXT)).toEqual({});
    expect(
      checkValues(
        { email: 'nombre@', site: 'example.org', page: 'http://example.org', slug: 'Sitio Malo' },
        rules,
        TEXT,
      ),
    ).toEqual({ email: 'email', site: 'url', page: 'https', slug: 'slug' });
    expect(
      checkValues(
        {
          email: 'nombre@example.org',
          site: 'http://example.org',
          page: 'https://example.org/aviso',
          slug: 'sitio-de-ejemplo',
        },
        rules,
        TEXT,
      ),
    ).toEqual({});
  });

  it('takes a slug of 63 characters at most, as the database does', () => {
    const rules = { slug: { shape: 'slug' } } as const;
    expect(checkValues({ slug: 'a'.repeat(63) }, rules, TEXT)).toEqual({});
    expect(checkValues({ slug: 'a'.repeat(64) }, rules, TEXT)).toEqual({ slug: 'slug' });
    expect(checkValues({ slug: 'dos--guiones' }, rules, TEXT)).toEqual({ slug: 'slug' });
  });

  it('takes a whole number within its bounds, and says which', () => {
    const rules = { days: { required: true, whole: { min: 1, max: 36_500 } } };
    for (const bad of ['0', '36501', '1.5', 'diez', '1e3']) {
      expect(checkValues({ days: bad }, rules, TEXT)).toEqual({ days: 'from 1 to 36500' });
    }
    expect(checkValues({ days: '30' }, rules, TEXT)).toEqual({});
  });
});

describe('where a refusal points', () => {
  const constraints = { parties_election_id_slug_key: ['slug', 'taken'] } as const;
  const fields = { website: ['website', 'invalid'] } as const;

  it("follows the API's field first, then a constraint the form knows", () => {
    expect(
      refusalProblem({ ok: false, error: 'invalid', field: 'website' }, constraints, fields),
    ).toEqual({ website: 'invalid' });
    expect(
      refusalProblem(
        { ok: false, error: 'taken', constraint: 'parties_election_id_slug_key' },
        constraints,
        fields,
      ),
    ).toEqual({ slug: 'taken' });
  });

  it('points nowhere when the refusal names neither', () => {
    expect(refusalProblem({ ok: false, error: 'stale' }, constraints, fields)).toBeUndefined();
    expect(
      refusalProblem({ ok: false, error: 'invalid', field: 'other' }, constraints, fields),
    ).toBeUndefined();
  });
});

describe('constraintProblems', () => {
  it("pairs each constraint's field with the page's message for it, else the fallback", () => {
    expect(
      constraintProblems(
        { slug_check: 'slug', elections_check1: 'territory' },
        { slug_check: 'Use only lowercase letters.' },
        'invalid',
      ),
    ).toEqual({
      slug_check: ['slug', 'Use only lowercase letters.'],
      elections_check1: ['territory', 'invalid'],
    });
  });
});
