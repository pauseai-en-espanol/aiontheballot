import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';

const CHECK_VIOLATION = '23514';
const NOT_NULL_VIOLATION = '23502';
const INVALID_PARAMETER_VALUE = '22023';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;

/** Casts each value to the domain as aiontheballot_web, the least privileged role: no grant is needed to use it. */
const castErrors = async (domain: string, values: readonly string[]): Promise<(string | null)[]> =>
  inRolledBackTransaction(async (client) => {
    await client.query('SET LOCAL ROLE aiontheballot_web');
    const codes: (string | null)[] = [];
    for (const value of values) {
      codes.push(await errorCode(client, `SELECT ${literal(value)}::${domain}`));
    }
    return codes;
  });

describe('app.localized', () => {
  const valid = ['{"es": "Partido Ejemplo A"}', '{"es": "Ejemplo", "ca": "Exemple", "es-mx": "x"}'];
  const invalid = [
    '{}',
    '[]',
    '"Ejemplo"',
    'null',
    '{"ES": "Ejemplo"}',
    '{"spanish": "Ejemplo"}',
    '{"es": ""}',
    '{"es": "  \\n "}',
    '{"es": 1}',
    '{"es": null}',
    '{"es": {"text": "Ejemplo"}}',
  ];

  it('accepts objects mapping locale codes to non-blank strings', async () => {
    expect(await castErrors('app.localized', valid)).toEqual(valid.map(() => null));
  });

  it.each(invalid)('rejects %s', async (value) => {
    expect(await castErrors('app.localized', [value])).toEqual([CHECK_VIOLATION]);
  });
});

describe('app.slug', () => {
  it('accepts lowercase words joined by single hyphens', async () => {
    const valid = ['es', 'test-a', 'generales-2026', 'criterio-de-ejemplo-3'];
    expect(await castErrors('app.slug', valid)).toEqual(valid.map(() => null));
  });

  it.each(['', 'Test-a', '-a', 'a-', 'a--b', '_tenant', 'a_b', 'a b', 'ñu'])(
    'rejects %j',
    async (value) => {
      expect(await castErrors('app.slug', [value])).toEqual([CHECK_VIOLATION]);
    },
  );
});

describe('app.locale', () => {
  it('accepts a language, optionally with a region, in lowercase', async () => {
    const valid = ['es', 'ca', 'es-mx'];
    expect(await castErrors('app.locale', valid)).toEqual(valid.map(() => null));
  });

  it.each(['', 'ES', 'es_ES', 'es-MX', 'spa', 'e'])('rejects %j', async (value) => {
    expect(await castErrors('app.locale', [value])).toEqual([CHECK_VIOLATION]);
  });
});

describe('private.stamp', () => {
  const ACTOR = '0190f8c4-0000-7000-8000-000000000102';
  const OTHER = '0190f8c4-0000-7000-8000-000000000103';
  const setup = `
    CREATE TABLE app.stamped (
      id int PRIMARY KEY, note text,
      created_by uuid NOT NULL, created_at timestamptz NOT NULL,
      updated_by uuid NOT NULL, updated_at timestamptz NOT NULL);
    CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.stamped
      FOR EACH ROW EXECUTE FUNCTION private.stamp('created_by', 'created_at', 'updated_by', 'updated_at');
    GRANT SELECT, INSERT, UPDATE ON app.stamped TO aiontheballot_admin;`;
  const actAs = (userId: string): string => `SELECT set_config('app.user_id', '${userId}', true)`;

  it('replaces caller-supplied actors and timestamps with the actor and the transaction time', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(setup);
      await client.query('SET LOCAL ROLE aiontheballot_admin');
      await client.query(actAs(ACTOR));
      const { rows } = await client.query(
        `INSERT INTO app.stamped VALUES (1, 'x', $1, '2000-01-01', $1, '2000-01-01')
         RETURNING created_by, updated_by, created_at = now() AS created_now, updated_at = now() AS updated_now`,
        [OTHER],
      );
      expect(rows).toEqual([
        { created_by: ACTOR, updated_by: ACTOR, created_now: true, updated_now: true },
      ]);
    });
  });

  it('keeps insert-time columns on update, and records who updated', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(setup);
      await client.query('SET LOCAL ROLE aiontheballot_admin');
      await client.query(actAs(ACTOR));
      await client.query(`INSERT INTO app.stamped (id, note) VALUES (1, 'x')`);
      await client.query(actAs(OTHER));
      const { rows } = await client.query(
        `UPDATE app.stamped SET note = 'y', created_by = $1, created_at = '2000-01-01', updated_at = '2000-01-01'
          WHERE id = 1
         RETURNING created_by, updated_by, created_at = now() AS created_now, updated_at = now() AS updated_now`,
        [OTHER],
      );
      expect(rows).toEqual([
        { created_by: ACTOR, updated_by: OTHER, created_now: true, updated_now: true },
      ]);
    });
  });

  it('writes no actor when none is set, so a NOT NULL actor column refuses the row', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(setup);
      await client.query('SET LOCAL ROLE aiontheballot_admin');
      expect(await errorCode(client, `INSERT INTO app.stamped (id, note) VALUES (1, 'x')`)).toBe(
        NOT_NULL_VIOLATION,
      );
    });
  });

  it.each(['note', 'missing_at', 'missing_by'])(
    'refuses an argument that is not an actor column or event timestamp of the table: %s',
    async (argument) => {
      await inRolledBackTransaction(async (client) => {
        await client.query(`
          CREATE TABLE app.stamped (id int PRIMARY KEY, note text);
          CREATE TRIGGER stamp BEFORE INSERT ON app.stamped
            FOR EACH ROW EXECUTE FUNCTION private.stamp('${argument}');`);
        await client.query(actAs(ACTOR));
        expect(await errorCode(client, `INSERT INTO app.stamped VALUES (1, 'x')`)).toBe(
          INVALID_PARAMETER_VALUE,
        );
      });
    },
  );
});
