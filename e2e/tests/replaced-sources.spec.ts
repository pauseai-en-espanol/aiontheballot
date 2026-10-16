import { messages } from '@aiontheballot/i18n/messages';
import pg from 'pg';

import { addMembership, createTenant, deleteAccounts, purgeTenant } from '../accounts.js';
import { signedInAccount } from '../admin.js';
import { expectAccessible } from '../axe.js';
import { ADMIN_URL } from '../servers.js';
import { expect, test } from '../test.js';

const en = messages.en;
const sources = en.admin.sources;
const cells = en.admin.cells;

const created: string[] = [];
test.afterAll(async () => {
  await deleteAccounts(created.splice(0));
});

/**
 * A draft election of the site's own, with a party, a criterion and two stored scans of its programme (no text to
 * extract), as the database owner makes them, stored by `editor`: what the test changes touches no other test.
 */
const electionWithScans = async (siteId: string, operatorId: string, editor: string) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [editor]);
    const one = async (sql: string, values: unknown[]) =>
      (await client.query<{ id: string }>(sql, values)).rows[0]?.id ?? '';
    const election = await one(
      `INSERT INTO app.elections (tenant_id, slug, type, name)
       VALUES ($1, 'generales-de-prueba', 'general', '{"es": "Elecciones de prueba"}') RETURNING id`,
      [siteId],
    );
    await client.query(
      `INSERT INTO app.methodologies (tenant_id, election_id, kind, demands_owner_id, body)
       VALUES ($1, $2, 'demands', $3, '{"es": "Metodología de prueba"}')`,
      [siteId, election, operatorId],
    );
    const party = await one(
      `INSERT INTO app.parties (tenant_id, election_id, slug, name, short_name, display_order)
       VALUES ($1, $2, 'partido-de-prueba', '{"es": "Partido de Prueba"}', '{"es": "PDP"}', 1) RETURNING id`,
      [siteId, election],
    );
    const criterion = await one(
      `INSERT INTO app.criteria (tenant_id, election_id, slug, title, short_title, description, display_order)
       VALUES ($1, $2, 'criterio-de-prueba', '{"es": "Criterio de prueba"}', '{"es": "Prueba"}',
               '{"es": "Descripción inventada."}', 1) RETURNING id`,
      [siteId, election],
    );
    const scans: string[] = [];
    for (const title of [
      'Programa de prueba, primera versión',
      'Programa de prueba, segunda versión',
    ]) {
      const file = await one(
        `INSERT INTO app.files (tenant_id, bucket, content_type, byte_size, sha256, original_filename)
         VALUES ($1, 'sources', 'application/pdf', 4, encode(sha256(convert_to($2, 'UTF8')), 'hex'), 'programa.pdf')
         RETURNING id`,
        [siteId, `${title} ${siteId}`],
      );
      const source = await one(
        `INSERT INTO app.source_documents (tenant_id, election_id, party_id, kind, title)
         VALUES ($1, $2, $3, 'pdf', $4) RETURNING id`,
        [siteId, election, party, title],
      );
      await client.query(
        `UPDATE app.source_documents SET file_id = $1, file_origin = 'uploaded' WHERE id = $2`,
        [file, source],
      );
      await client.query(
        `UPDATE app.source_documents SET extraction_status = 'not_applicable' WHERE id = $1`,
        [source],
      );
      scans.push(source);
    }
    await client.query('COMMIT');
    return { party, criterion, scans };
  } finally {
    await client.end();
  }
};

test.describe('replaced sources (PLAN D14)', () => {
  test('are marked once from their page, listed last, and offered for no new quote', async ({
    page,
  }) => {
    const site = await createTenant({ operator: true });
    try {
      const editor = await signedInAccount(page, created, 'Persona editora');
      await addMembership(editor.id, site.slug, 'editor');
      const { party, criterion, scans } = await electionWithScans(
        site.id,
        site.operatorId ?? '',
        editor.id,
      );
      const base = `${ADMIN_URL}/t/${site.slug}/e/generales-de-prueba/sources`;

      await page.goto(`${base}/${scans[0]}`);
      await expect(page.getByText(sources.replaceIntro)).toBeVisible();
      await page.getByRole('button', { name: sources.replace }).click();
      const dialog = page.getByRole('alertdialog', { name: sources.replaceTitle });
      await expect(dialog).toContainText(sources.replaceBody);
      await dialog.getByRole('button', { name: sources.replace }).click();
      await expect(page.locator('#page-announcer')).toHaveText(sources.replaceDone);
      await expect(page.locator('#page-announcer')).toBeFocused();
      await page.reload();
      await expect(page.getByRole('button', { name: sources.replace })).toHaveCount(0);
      await expectAccessible(page);

      // Listed last, said in words.
      await page.goto(base);
      const titles = page.getByRole('table').getByRole('rowheader');
      await expect(titles).toHaveText([
        /Programa de prueba, segunda versión/u,
        /Programa de prueba, primera versión/u,
      ]);
      await expect(page.getByRole('row', { name: /primera versión/u })).toContainText(
        sources.replaced,
      );

      // The cell editor offers only the newer one.
      await page.goto(
        `${ADMIN_URL}/t/${site.slug}/e/generales-de-prueba/cells/${party}/${criterion}`,
      );
      await page.getByRole('button', { name: cells.create }).click();
      const choice = page.getByLabel(cells.quoteSource);
      await expect(choice.getByRole('option', { name: /segunda versión/u })).toHaveCount(1);
      await expect(choice.getByRole('option', { name: /primera versión/u })).toHaveCount(0);
    } finally {
      await purgeTenant(site.id, site.operatorId);
    }
  });

  test('warn in the cell editor of a "not mentioned" checked only against a document since replaced (D20)', async ({
    page,
  }) => {
    const site = await createTenant({ operator: true });
    try {
      const editor = await signedInAccount(page, created, 'Persona editora');
      await addMembership(editor.id, site.slug, 'editor');
      const { party, criterion, scans } = await electionWithScans(
        site.id,
        site.operatorId ?? '',
        editor.id,
      );
      // A draft "not mentioned", checked against the first version; then that version is marked replaced.
      const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.user_id', $1, true)`, [editor.id]);
        const { rows } = await client.query<{ id: string; election_id: string }>(
          `INSERT INTO app.assessments (tenant_id, election_id, party_id, criterion_id, draft_rating, draft_summary)
           SELECT tenant_id, election_id, id, $2, 'not_mentioned', '{"es": "Un resumen inventado."}'
             FROM app.parties WHERE tenant_id = $1 AND id = $3
           RETURNING id, election_id`,
          [site.id, criterion, party],
        );
        await client.query(
          `INSERT INTO app.draft_checked_documents (assessment_id, tenant_id, election_id, source_document_id)
           VALUES ($1, $2, $3, $4)`,
          [rows[0]?.id, site.id, rows[0]?.election_id, scans[0]],
        );
        await client.query(`UPDATE app.source_documents SET replaced_at = now() WHERE id = $1`, [
          scans[0],
        ]);
        await client.query('COMMIT');
      } finally {
        await client.end();
      }
      await page.goto(
        `${ADMIN_URL}/t/${site.slug}/e/generales-de-prueba/cells/${party}/${criterion}`,
      );
      await expect(page.getByRole('region', { name: cells.replacedOnlyTitle })).toContainText(
        cells.replacedOnlyBody,
      );
      await expectAccessible(page);
    } finally {
      await purgeTenant(site.id, site.operatorId);
    }
  });
});
