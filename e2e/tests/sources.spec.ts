import { messages } from '@aiontheballot/i18n/messages';
import { readFile } from 'node:fs/promises';

import { addMembership, asOwner, deleteAccounts } from '../accounts.js';
import { signedInAccount } from '../admin.js';
import { expectAccessible } from '../axe.js';
import { ADMIN_URL } from '../servers.js';
import { expect, test } from '../test.js';

const en = messages.en;
const sources = en.admin.sources;
const LIST = `${ADMIN_URL}/t/ejemplo-a/e/generales-de-ejemplo/sources`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const created: string[] = [];
const made: string[] = [];
test.afterAll(async () => {
  await deleteAccounts(created.splice(0));
  // A stored source is kept for good, with its text: only the owner removes the tests' own, in one transaction (a DO
  // block) so nothing else ever runs while the text's guard is off.
  for (const id of made.splice(0).filter((candidate) => UUID.test(candidate))) {
    await asOwner(`
      DO $$
      DECLARE file uuid;
      BEGIN
        SELECT file_id INTO file FROM app.source_documents WHERE id = '${id}';
        ALTER TABLE app.source_texts DISABLE TRIGGER USER;
        DELETE FROM app.source_texts WHERE source_document_id = '${id}';
        ALTER TABLE app.source_texts ENABLE TRIGGER USER;
        DELETE FROM app.job_requests WHERE source_document_id = '${id}';
        DELETE FROM app.source_documents WHERE id = '${id}';
        DELETE FROM app.files f WHERE f.id = file
          AND NOT EXISTS (SELECT 1 FROM app.source_documents s WHERE s.file_id = f.id);
      END $$;`);
  }
});

test.describe('sources (editorial workflow §7)', () => {
  test('are listed with their state in words, programmes first', async ({ page }) => {
    const { id } = await signedInAccount(page, created, 'Persona lectora de fuentes');
    await addMembership(id, 'ejemplo-a', 'reviewer');
    await page.goto(LIST);
    await expect(page.getByRole('heading', { level: 2, name: sources.title })).toBeVisible();
    const programme = page.getByRole('row', { name: /Programa de ejemplo/ });
    await expect(programme).toContainText(sources.programmeTag);
    await expect(programme).toContainText(`${sources.states.done} · ${sources.citable}`);
    // Reviewers read sources; only editors and country admins add them.
    await expect(page.getByRole('link', { name: sources.add })).toHaveCount(0);
    await expectAccessible(page);
  });

  test("are added by an editor, take a stored copy whose text the worker extracts, and can't change after", async ({
    page,
  }) => {
    const { id } = await signedInAccount(page, created, 'Persona editora de fuentes');
    await addMembership(id, 'ejemplo-a', 'editor');
    await page.goto(LIST);
    await page.getByRole('link', { name: sources.add }).click();
    await expectAccessible(page);
    const title = `Envío de prueba ${crypto.randomUUID()}`;
    await page.getByLabel(sources.fields.title).fill(title);
    await page.getByLabel(sources.fields.kind).selectOption({
      label: sources.kinds.party_submission,
    });
    await page.getByLabel(sources.fields.party).selectOption({ label: 'Partido Ejemplo B' });
    // Its language by name, the site's own first (admin forms §2, sources).
    await expect(
      page.getByRole('combobox', {
        name: `${sources.fields.language} (${en.admin.form.optional})`,
      }),
    ).toHaveValue('es');
    // Its copy chosen with it, and stored right after it (PLAN R194): what that means is said first.
    await page.getByLabel(sources.copyChoice.upload).check();
    await expect(page.getByText(sources.copy.contributor)).toBeVisible();
    await page.getByRole('button', { name: sources.fields.save }).click();
    await expect(page.getByText(en.admin.form.file.problems.missing)).toBeVisible();
    const bytes = Buffer.from(
      `Primer bloque de un envío inventado.\n\nSegundo bloque, también inventado: ${title}.`,
    );
    await page.locator('input[type="file"]').setInputFiles({
      name: 'envio.txt',
      mimeType: 'text/plain',
      buffer: bytes,
    });
    await expect(page.getByText(/^envio\.txt · \d+ KB · TXT$/u)).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: sources.fields.save }).click();

    // Its own page, the copy stored.
    await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();
    made.push(new URL(page.url()).pathname.split('/').at(-1) ?? '');
    await expect(page.locator('#page-announcer')).toHaveText(sources.fields.added);
    await expect(page.getByRole('link', { name: sources.copy.download })).toBeVisible();

    // The worker extracts its text a moment later: a block per paragraph.
    await expect(async () => {
      await page.reload();
      await expect(page.getByText('§ 2')).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await page.getByText('§ 1').click();
    await expect(page.getByText('Primer bloque de un envío inventado.')).toBeVisible();
    await expect(page.locator('dl')).toContainText(`${sources.states.done} · ${sources.citable}`);
    // Stored, the source never changes, and is kept.
    await expect(page.getByRole('button', { name: sources.fields.save })).toHaveCount(0);
    await expect(page.getByRole('button', { name: sources.delete })).toHaveCount(0);
    await expectAccessible(page);

    // The copy comes back as the same bytes, as a download.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: sources.copy.download }).click(),
    ]);
    expect(await readFile(await download.path())).toEqual(bytes);
  });

  test('are deleted while they have no copy, and refuse a file of a type no source has', async ({
    page,
  }) => {
    const { id } = await signedInAccount(page, created, 'Persona editora de borradores');
    await addMembership(id, 'ejemplo-a', 'editor');
    await page.goto(`${LIST}/new`);
    const title = `Fuente sin copia ${crypto.randomUUID()}`;
    await page.getByLabel(sources.fields.title).fill(title);
    await page.getByRole('button', { name: sources.fields.save }).click();
    await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();
    made.push(new URL(page.url()).pathname.split('/').at(-1) ?? '');

    // One view of its details: the facts, and "Edit" while it has no copy (PLAN R194).
    await expect(page.getByRole('button', { name: sources.fields.save })).toHaveCount(0);
    await page.getByRole('button', { name: en.admin.form.edit }).click();
    await expect(page.getByLabel(sources.fields.title)).toBeFocused();
    await page.getByLabel(sources.fields.title).fill(`${title} (corregida)`);
    await page.getByRole('button', { name: sources.fields.save }).click();
    await expect(page.getByRole('status').filter({ hasText: sources.fields.saved })).toBeVisible();
    await page.getByRole('button', { name: en.admin.form.stopEditing }).click();
    await expect(page.getByRole('button', { name: en.admin.form.edit })).toBeFocused();
    await expect(
      page.getByRole('heading', { level: 2, name: `${title} (corregida)` }),
    ).toBeVisible();

    // A file of a type no source has is refused at the field, before anything is sent.
    await page.locator('input[type="file"]').setInputFiles({
      name: 'programa.exe',
      mimeType: 'application/x-msdownload',
      buffer: Buffer.from('MZ'),
    });
    await expect(page.getByText(en.admin.form.file.problems.type)).toBeVisible();

    await page.getByRole('button', { name: sources.delete }).click();
    const dialog = page.getByRole('alertdialog', { name: sources.deleteTitle });
    await dialog.getByRole('button', { name: sources.delete }).click();
    await expect(page).toHaveURL(LIST);
    await expect(page.locator('#page-announcer')).toHaveText(sources.deleted);
    await expect(page.getByRole('link', { name: title })).toHaveCount(0);
  });
});
