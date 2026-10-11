import type pg from 'pg';

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { demoContentSql, programmeText } from '../demo/demo-content.js';
import { errorCode, inRolledBackTransaction } from './db.js';

const SITE = '0190f8c4-de70-7000-8000-0000000000d1';
const OPERATOR = '0190f8c4-de70-7000-8000-0000000000d2';

/** A fictional demo site, as a platform admin would create it, with its operator. */
const createSite = async (
  client: pg.Client,
  { country = 'XD', kind = 'demands', active = true, locale = 'es' } = {},
) => {
  await client.query(
    `INSERT INTO app.organizations (id, display_name, legal_name) VALUES ($1, '{"es": "Organización de demostración"}',
     'Organización de Demostración')`,
    [OPERATOR],
  );
  await client.query(
    `INSERT INTO app.tenants (id, slug, country_code, default_locale, enabled_locales, display_name, methodology_kind,
                              report_retention_days, active)
     VALUES ($1, 'demo', $2, $5, '{es,en}', '{"es": "Sitio de demostración"}', $3, 365, $4)`,
    [SITE, country, kind, active, locale],
  );
  await client.query(
    `INSERT INTO app.tenant_organizations (tenant_id, organization_id, role) VALUES ($1, $2, 'operator')`,
    [SITE, OPERATOR],
  );
};

describe('the demo content (PLAN R130)', () => {
  it('fills an empty demo site through the real triggers: a live election, pending cells and a few published', async () => {
    await inRolledBackTransaction(async (client) => {
      await createSite(client);
      await client.query(demoContentSql('demo'));
      await client.query('SET LOCAL ROLE aiontheballot_web');
      const { rows } = await client.query<{
        status: string;
        parties: number;
        criteria: number;
        revisions: string[];
      }>(
        `SELECT e.status,
                (SELECT count(*)::int FROM app.parties p WHERE p.election_id = e.id) AS parties,
                (SELECT count(*)::int FROM app.criteria c WHERE c.election_id = e.id) AS criteria,
                ARRAY(SELECT r.rating::text FROM app.assessment_revisions r WHERE r.election_id = e.id ORDER BY 1) AS revisions
           FROM app.elections e WHERE e.tenant_id = $1`,
        [SITE],
      );
      expect(rows).toEqual([
        {
          status: 'live',
          parties: 3,
          criteria: 4,
          revisions: ['does_not_meet', 'meets', 'not_mentioned', 'partially_meets'],
        },
      ]);
      await client.query('RESET ROLE');
      // The fictional members are gone; the stored copies are the bytes put-file stores.
      const { rows: members } = await client.query(
        'SELECT 1 FROM app.memberships WHERE tenant_id = $1',
        [SITE],
      );
      expect(members).toEqual([]);
      const { rows: files } = await client.query<{ sha256: string }>(
        'SELECT sha256 FROM app.files WHERE tenant_id = $1 ORDER BY original_filename',
        [SITE],
      );
      expect(files.map((f) => f.sha256)).toEqual(
        (['a', 'b'] as const).map((key) =>
          createHash('sha256').update(programmeText(key)).digest('hex'),
        ),
      );
    });
  });

  it('fills a site whose main language is English too', async () => {
    await inRolledBackTransaction(async (client) => {
      await createSite(client, { locale: 'en' });
      await client.query(demoContentSql('demo'));
      const { rows } = await client.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM app.assessment_revisions WHERE tenant_id = $1',
        [SITE],
      );
      expect(rows).toEqual([{ n: 4 }]);
    });
  });

  it("rates on a descriptive site's scale", async () => {
    await inRolledBackTransaction(async (client) => {
      await createSite(client, { kind: 'descriptive' });
      await client.query(demoContentSql('demo'));
      const { rows } = await client.query<{ rating: string }>(
        'SELECT rating::text FROM app.assessment_revisions WHERE tenant_id = $1 ORDER BY 1',
        [SITE],
      );
      expect(rows.map((r) => r.rating)).toEqual(['green', 'not_mentioned', 'red', 'yellow']);
    });
  });

  it.each([
    ['a site in a real country', { country: 'ES' }],
    ['a site not yet active', { active: false }],
  ])('refuses %s, changing nothing', async (_name, site) => {
    await inRolledBackTransaction(async (client) => {
      await createSite(client, site);
      expect(await errorCode(client, demoContentSql('demo'))).toBe('P0001');
      const { rows } = await client.query('SELECT 1 FROM app.elections WHERE tenant_id = $1', [
        SITE,
      ]);
      expect(rows).toEqual([]);
    });
  });

  it('refuses a site that already has an election, and a site that does not exist', async () => {
    await inRolledBackTransaction(async (client) => {
      await createSite(client);
      await client.query(demoContentSql('demo'));
      expect(await errorCode(client, demoContentSql('demo'))).toBe('P0001');
      expect(await errorCode(client, demoContentSql('no-existe'))).toBe('P0001');
    });
  });

  it('takes only a slug', () => {
    expect(() => demoContentSql("demo'; DROP TABLE app.tenants; --")).toThrow(/slug/);
  });
});
