import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { REFUSAL_KEYS } from '../database-errors.js';
import { API_REFUSAL_KEYS } from './routes.js';

/** The admin words each refusal from packages/i18n; read as a file, since the API ships no UI strings. */
const errorKeys = (locale: string): string[] =>
  Object.keys(
    (
      JSON.parse(
        readFileSync(
          new URL(`../../../../packages/i18n/src/messages/${locale}.json`, import.meta.url),
          'utf8',
        ),
      ) as { errors: Record<string, string> }
    ).errors,
  );

describe('refusal keys (editorial workflow §2.3)', () => {
  it.each(['en', 'es'])(
    'each have their words in %s, the database’s and the API’s own',
    (locale) => {
      expect(errorKeys(locale)).toEqual(
        expect.arrayContaining([...REFUSAL_KEYS, ...API_REFUSAL_KEYS, 'forbidden']),
      );
    },
  );
});
