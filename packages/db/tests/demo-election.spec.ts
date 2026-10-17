import type pg from 'pg';

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  DEMO_ELECTION_PARTIES,
  DEMO_ELECTION_TOPICS,
  demoElectionSql,
  demoProgrammeText,
} from '../demo/demo-election.js';
import { inRolledBackTransaction } from './db.js';

const SITE = '0190f8c4-de70-7000-8000-0000000000e1';
const OPERATOR = '0190f8c4-de70-7000-8000-0000000000e2';
const ELECTION = '0190f8c4-de70-7000-8000-0000000000e3';

/** A fictional demo site with its operator, and a draft election with fictional parties and the demo's criteria. */
const createSite = async (
  client: pg.Client,
  {
    country = 'XD',
    kind = 'demands',
    parties = DEMO_ELECTION_PARTIES,
    criteria = Object.keys(DEMO_ELECTION_TOPICS),
  }: { country?: string; kind?: string; parties?: number; criteria?: string[] } = {},
) => {
  await client.query(
    `INSERT INTO app.organizations (id, display_name, legal_name) VALUES ($1, '{"es": "Organización de demostración"}',
     'Organización de Demostración')`,
    [OPERATOR],
  );
  await client.query(
    `INSERT INTO app.tenants (id, slug, country_code, default_locale, enabled_locales, display_name, methodology_kind,
                              report_retention_days, active)
     VALUES ($1, 'demo', $2, 'es', ARRAY['es', 'en']::app.locale[], '{"es": "Sitio de demostración"}', $3, 365, true)`,
    [SITE, country, kind],
  );
  await client.query(
    `INSERT INTO app.tenant_organizations (tenant_id, organization_id, role) VALUES ($1, $2, 'operator')`,
    [SITE, OPERATOR],
  );
  await client.query(
    `INSERT INTO app.elections (id, tenant_id, slug, type, name)
     VALUES ($1, $2, 'pruebas', 'general', '{"es": "Elecciones de prueba"}')`,
    [ELECTION, SITE],
  );
  for (let p = 0; p < parties; p += 1) {
    const letter = String.fromCharCode(65 + p);
    await client.query(
      `INSERT INTO app.parties (tenant_id, election_id, slug, name, short_name, display_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        SITE,
        ELECTION,
        `partido-ejemplo-${letter.toLowerCase()}`,
        { es: `Partido Ejemplo ${letter}` },
        { es: `PE${letter}` },
        p + 1,
      ],
    );
  }
  for (const [index, slug] of criteria.entries()) {
    await client.query(
      `INSERT INTO app.criteria (tenant_id, election_id, slug, title, short_title, description, display_order)
       VALUES ($1, $2, $3, '{"es": "Criterio de prueba"}', '{"es": "Prueba"}', '{"es": "Descripción de prueba"}', $4)`,
      [SITE, ELECTION, slug, index + 1],
    );
  }
};

/** Runs SQL as the tables' owner, as Dani runs it; in a savepoint, so a refusal leaves the transaction usable. */
const asOwner = async (client: pg.Client, sql: string): Promise<void> => {
  await client.query('SAVEPOINT demo');
  try {
    await client.query('SET LOCAL ROLE aiontheballot_owner');
    await client.query(sql);
    await client.query('RESET ROLE');
    await client.query('RELEASE SAVEPOINT demo');
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT demo');
    throw error;
  }
};

const refusal = (client: pg.Client, sql: string) =>
  asOwner(client, sql).then(
    () => null,
    (e: { code?: string }) => e.code,
  );

describe('a demo election, filled (PLAN R214)', () => {
  it('rates every cell of a draft election of fictional parties, through the real triggers, and puts it live', async () => {
    await inRolledBackTransaction(async (client) => {
      await createSite(client);
      await asOwner(client, demoElectionSql('demo', 'pruebas'));
      await client.query('SET LOCAL ROLE aiontheballot_web');
      const { rows } = await client.query<{ status: string; ratings: string[]; published: number }>(
        `SELECT e.status,
                ARRAY(SELECT DISTINCT r.rating::text FROM app.assessment_revisions r WHERE r.election_id = e.id
                       ORDER BY 1) AS ratings,
                (SELECT count(*)::int FROM app.assessment_revisions r WHERE r.election_id = e.id) AS published
           FROM app.elections e WHERE e.id = $1`,
        [ELECTION],
      );
      const cells = DEMO_ELECTION_PARTIES * Object.keys(DEMO_ELECTION_TOPICS).length;
      expect(rows).toEqual([
        {
          status: 'live',
          ratings: ['does_not_meet', 'meets', 'not_mentioned', 'partially_meets'],
          published: cells,
        },
      ]);
      await client.query('RESET ROLE');
      // Each party's programme is published, its stored copy the bytes put-file stores; the fictional members are gone.
      const { rows: files } = await client.query<{ sha256: string }>(
        'SELECT sha256 FROM app.files WHERE tenant_id = $1 AND bucket = $2 ORDER BY original_filename',
        [SITE, 'sources'],
      );
      const expected = Array.from({ length: DEMO_ELECTION_PARTIES }, (_, p) =>
        createHash('sha256')
          .update(demoProgrammeText(p + 1))
          .digest('hex'),
      );
      expect(files.map((f) => f.sha256).sort()).toEqual([...expected].sort());
      expect(
        (
          await client.query(
            `SELECT 1 FROM app.parties WHERE election_id = $1 AND programme_status <> 'published'`,
            [ELECTION],
          )
        ).rows,
      ).toEqual([]);
      expect(
        (await client.query('SELECT 1 FROM app.memberships WHERE tenant_id = $1', [SITE])).rows,
      ).toEqual([]);
    });
  });

  it("rates on a descriptive site's scale", async () => {
    await inRolledBackTransaction(async (client) => {
      await createSite(client, { kind: 'descriptive' });
      await asOwner(client, demoElectionSql('demo', 'pruebas'));
      const { rows } = await client.query<{ rating: string }>(
        'SELECT DISTINCT rating::text FROM app.assessment_revisions WHERE election_id = $1 ORDER BY 1',
        [ELECTION],
      );
      expect(rows.map((r) => r.rating)).toEqual(['green', 'not_mentioned', 'red', 'yellow']);
    });
  });

  it.each([
    ['a site in a real country', { country: 'ES' }],
    ['another number of parties', { parties: DEMO_ELECTION_PARTIES - 1 }],
    [
      'other criteria',
      { criteria: [...Object.keys(DEMO_ELECTION_TOPICS).slice(1), 'otro-criterio'] },
    ],
  ])('refuses %s, changing nothing', async (_name, site) => {
    await inRolledBackTransaction(async (client) => {
      await createSite(client, site);
      expect(await refusal(client, demoElectionSql('demo', 'pruebas'))).toBe('P0001');
      expect(
        (await client.query(`SELECT status FROM app.elections WHERE id = $1`, [ELECTION])).rows,
      ).toEqual([{ status: 'draft' }]);
    });
  });

  it('refuses a party that is not an obviously fictional "Partido Ejemplo", so it never rates a real one', async () => {
    await inRolledBackTransaction(async (client) => {
      await createSite(client);
      await client.query(
        `UPDATE app.parties SET name = '{"es": "Partido Real"}' WHERE election_id = $1 AND display_order = 3`,
        [ELECTION],
      );
      expect(await refusal(client, demoElectionSql('demo', 'pruebas'))).toBe('P0001');
      expect(
        (await client.query('SELECT 1 FROM app.assessments WHERE election_id = $1', [ELECTION]))
          .rows,
      ).toEqual([]);
    });
  });

  it('refuses an election that is not an untouched draft, and one that does not exist', async () => {
    await inRolledBackTransaction(async (client) => {
      await createSite(client);
      await asOwner(client, demoElectionSql('demo', 'pruebas'));
      expect(await refusal(client, demoElectionSql('demo', 'pruebas'))).toBe('P0001');
      expect(await refusal(client, demoElectionSql('demo', 'no-existe'))).toBe('P0001');
    });
  });

  it('takes only slugs, and prints each programme as put-file stores it', () => {
    expect(() => demoElectionSql("demo'; DROP TABLE app.tenants; --", 'pruebas')).toThrow(/slug/);
    expect(() => demoElectionSql('demo', "x'; --")).toThrow(/slug/);
    expect(demoProgrammeText(1)).toMatch(/inventado/);
    expect(() => demoProgrammeText(DEMO_ELECTION_PARTIES + 1)).toThrow();
  });
});
