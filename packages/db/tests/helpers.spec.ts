import { normalizeForMatch } from '@aiontheballot/domain/matching';
import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';

const RESTRICT_VIOLATION = '23001';

describe('private.normalize_for_match', () => {
  // Fictional text only.
  const fixtures = [
    'ﬁnanciación de la ﬂota',
    'regu­lación',
    'inteli-\n  gencia artificial',
    'inteli- \r\n gencia',
    'inteli-\n\n\ngencia',
    'a-\nb-\nc otra-\n línea',
    'socio-económico',
    '“agencia” — ‘supervisión’ – «control»',
    '  una frase \n\n de   ejemplo ',
    'Partido Ejemplo A propone una “moratoria” en la pág. 12…',
  ];

  it.each(fixtures)('matches the TypeScript port for %j', async (input) => {
    const [row] = await inRolledBackTransaction(
      async (client) =>
        (await client.query('SELECT private.normalize_for_match($1) AS out', [input])).rows,
    );
    expect(row.out).toBe(normalizeForMatch(input));
  });
});

describe('private.forbid_tenant_change', () => {
  it('rejects changing tenant_id but allows other updates', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(`
        CREATE TABLE app.probe (id int PRIMARY KEY, tenant_id uuid NOT NULL, note text);
        CREATE TRIGGER probe_tenant BEFORE UPDATE ON app.probe
          FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();
        INSERT INTO app.probe VALUES (1, '0190f8c4-0000-7000-8000-00000000000a', 'before');`);
      expect(await errorCode(client, `UPDATE app.probe SET note = 'after'`)).toBeNull();
      expect(
        await errorCode(
          client,
          `UPDATE app.probe SET tenant_id = '0190f8c4-0000-7000-8000-00000000000b'`,
        ),
      ).toBe(RESTRICT_VIOLATION);
    });
  });
});

describe('private.forbid_mutation', () => {
  const setup = `
    CREATE TABLE app.history (id int PRIMARY KEY);
    ALTER TABLE app.history OWNER TO aiontheballot_owner;
    GRANT SELECT, UPDATE, DELETE, TRUNCATE ON app.history TO aiontheballot_admin;
    CREATE TRIGGER history_rows BEFORE UPDATE OR DELETE ON app.history
      FOR EACH ROW EXECUTE FUNCTION private.forbid_mutation();
    CREATE TRIGGER history_truncate BEFORE TRUNCATE ON app.history
      FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_mutation();
    INSERT INTO app.history VALUES (1), (2);`;

  it('refuses updates, deletes and truncation by a runtime role', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(setup);
      await client.query('SET LOCAL ROLE aiontheballot_admin');
      expect(await errorCode(client, 'UPDATE app.history SET id = 3 WHERE id = 1')).toBe(
        RESTRICT_VIOLATION,
      );
      expect(await errorCode(client, 'DELETE FROM app.history')).toBe(RESTRICT_VIOLATION);
      expect(await errorCode(client, 'TRUNCATE app.history')).toBe(RESTRICT_VIOLATION);
    });
  });

  it('ignores app.purge when a runtime role sets it itself', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(setup);
      await client.query('SET LOCAL ROLE aiontheballot_admin');
      await client.query(`SELECT set_config('app.purge', 'on', true)`);
      expect(await errorCode(client, 'DELETE FROM app.history')).toBe(RESTRICT_VIOLATION);
      expect(await errorCode(client, 'TRUNCATE app.history')).toBe(RESTRICT_VIOLATION);
    });
  });

  it('refuses the owner too, unless purging', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(setup);
      await client.query('SET LOCAL ROLE aiontheballot_owner');
      expect(await errorCode(client, 'DELETE FROM app.history')).toBe(RESTRICT_VIOLATION);
      await client.query(`SELECT set_config('app.purge', 'on', true)`);
      expect(await errorCode(client, 'DELETE FROM app.history WHERE id = 1')).toBeNull();
      expect(await errorCode(client, 'TRUNCATE app.history')).toBeNull();
    });
  });
});
