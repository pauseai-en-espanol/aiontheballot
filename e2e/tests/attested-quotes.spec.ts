import { messages } from '@aiontheballot/i18n/messages';
import pg from 'pg';

import { addMembership, createTenant, deleteAccounts, purgeTenant } from '../accounts.js';
import { signedInAccount } from '../admin.js';
import { expectAccessible } from '../axe.js';
import { ADMIN_URL } from '../servers.js';
import { expect, test } from '../test.js';

const en = messages.en;
const cells = en.admin.cells;
const attestation = cells.attestation;
const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);

const created: string[] = [];
test.afterAll(async () => {
  await deleteAccounts(created.splice(0));
});

/** A 1×1 PNG: a fictional screenshot. */
const SCREENSHOT = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const QUOTE = 'Una frase de ejemplo dicha en un vídeo inventado';

/**
 * A draft election of the site's own, with a party, a criterion and a video with no text (its copy stored by `editor`,
 * whose methodology admits video), as the database owner makes them: what the test changes touches no other test.
 */
const electionWithVideo = async (siteId: string, operatorId: string, editor: string) => {
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
      `INSERT INTO app.methodologies (tenant_id, election_id, kind, demands_owner_id, body, admissible_source_kinds)
       VALUES ($1, $2, 'demands', $3, '{"es": "Metodología de prueba"}', '{pdf,web_page,video}')`,
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
    const file = await one(
      `INSERT INTO app.files (tenant_id, bucket, content_type, byte_size, sha256, original_filename)
       VALUES ($1, 'sources', 'video/mp4', 4, encode(sha256(convert_to($2, 'UTF8')), 'hex'), 'video.mp4')
       RETURNING id`,
      [siteId, `vídeo de prueba ${siteId}`],
    );
    const source = await one(
      `INSERT INTO app.source_documents (tenant_id, election_id, party_id, kind, title)
       VALUES ($1, $2, $3, 'video', 'Vídeo de prueba') RETURNING id`,
      [siteId, election, party],
    );
    await client.query(
      `UPDATE app.source_documents SET file_id = $1, file_origin = 'uploaded' WHERE id = $2`,
      [file, source],
    );
    await client.query(
      `UPDATE app.source_documents SET extraction_status = 'not_applicable' WHERE id = $1`,
      [source],
    );
    await client.query('COMMIT');
    return { party, criterion };
  } finally {
    await client.end();
  }
};

test.describe('attested quotes (editorial workflow C4)', () => {
  test('take a screenshot and clip times from an editor, and are attested and withdrawn by someone else', async ({
    page,
    newContext,
  }) => {
    const site = await createTenant({ operator: true });
    try {
      const editor = await signedInAccount(page, created, 'Persona editora');
      await addMembership(editor.id, site.slug, 'editor');
      const { party, criterion } = await electionWithVideo(
        site.id,
        site.operatorId ?? '',
        editor.id,
      );
      const cellUrl = `${ADMIN_URL}/t/${site.slug}/e/generales-de-prueba/cells/${party}/${criterion}`;

      // The editor starts the cell and quotes the video.
      await page.goto(cellUrl);
      await page.getByRole('button', { name: cells.create }).click();
      await page.getByLabel(cells.quoteSource).selectOption({ label: 'Vídeo de prueba' });
      await page.getByLabel(cells.quote).fill(QUOTE);
      await page.getByRole('button', { name: cells.add }).click();
      await expect(page.getByRole('status').filter({ hasText: cells.added })).toBeVisible();
      const item = page.getByRole('listitem').filter({ hasText: QUOTE });
      await expect(item).toContainText(attestation.notYet);
      await expect(item).toContainText(attestation.noFile);
      await expect(item).toContainText(attestation.noClip);

      // Where in the video it is said, then the screenshot.
      // As minutes and seconds (PLAN R196); a time no clock says is refused at its field.
      await item.getByLabel(attestation.clipStart).fill('0:75');
      await item.getByRole('button', { name: new RegExp(attestation.clipLabel) }).click();
      await expect(item.getByText(attestation.clipTimeInvalid)).toBeVisible();
      await item.getByLabel(attestation.clipStart).fill('0:12.5');
      await item.getByLabel(attestation.clipEnd).fill('0:20');
      await item.getByRole('button', { name: new RegExp(attestation.clipLabel) }).click();
      await expect(page.locator('#page-announcer')).toHaveText(attestation.clipSaved);
      await expect(item).toContainText(fill(attestation.clip, { start: '0:12.5', end: '0:20' }));
      await item
        .getByLabel(`${attestation.fileLabel}: ${QUOTE}`)
        .setInputFiles({ name: 'captura.png', mimeType: 'image/png', buffer: SCREENSHOT });
      await item.getByRole('button', { name: attestation.upload }).click();
      await expect(page.locator('#page-announcer')).toHaveText(attestation.uploaded);
      await expect(item).toContainText(attestation.download);
      // The author doesn't attest their own quote.
      await expect(item).toContainText(attestation.authorCannot);
      await expect(item.getByRole('button', { name: new RegExp(attestation.attest) })).toHaveCount(
        0,
      );
      await expectAccessible(page);

      // A reviewer, in a browser of their own, checks the screenshot and attests.
      const theirs = await newContext();
      const reviewerPage = await theirs.newPage();
      const reviewer = await signedInAccount(reviewerPage, created, 'Persona revisora');
      await addMembership(reviewer.id, site.slug, 'reviewer');
      await reviewerPage.goto(cellUrl);
      const theirItem = reviewerPage.getByRole('listitem').filter({ hasText: QUOTE });
      const download = await reviewerPage.request.get(
        `${await theirItem.getByRole('link', { name: attestation.download }).getAttribute('href')}`.replace(
          /^\//u,
          `${ADMIN_URL}/`,
        ),
      );
      expect(download.status()).toBe(200);
      expect(download.headers()['content-type']).toBe('image/png');
      expect(download.headers()['content-disposition']).toMatch(/^attachment/u);
      expect(download.headers()['content-security-policy']).toContain('sandbox');
      expect(Buffer.compare(await download.body(), SCREENSHOT)).toBe(0);
      await theirItem.getByRole('button', { name: new RegExp(attestation.attest) }).click();
      await expect(reviewerPage.locator('#page-announcer')).toHaveText(attestation.attested);
      await expect(theirItem).toContainText(
        fill(attestation.attestedBy, { name: 'Persona revisora' }),
      );
      await expectAccessible(reviewerPage);

      // Withdrawn, it can be attested again.
      await theirItem.getByRole('button', { name: new RegExp(attestation.withdraw) }).click();
      await expect(reviewerPage.locator('#page-announcer')).toHaveText(attestation.withdrawn);
      await expect(theirItem).toContainText(attestation.notYet);
      await expect(
        theirItem.getByRole('button', { name: new RegExp(attestation.attest) }),
      ).toBeVisible();
    } finally {
      await purgeTenant(site.id, site.operatorId);
    }
  });
});
