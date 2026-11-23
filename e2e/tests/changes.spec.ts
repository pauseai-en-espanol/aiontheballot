import { messages } from '@aiontheballot/i18n/messages';

import { addMembership, asOwner, createTenant, deleteAccounts, purgeTenant } from '../accounts.js';
import { signedInAccount } from '../admin.js';
import { expectAccessible } from '../axe.js';
import { ADMIN_URL } from '../servers.js';
import { expect, test } from '../test.js';

const en = messages.en;

/** A 2×1 PNG, fictional: a party's logo. */
const PARTY_LOGO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAC0lEQVR42mNggAIAAAkAAWj2z04AAAAASUVORK5CYII=',
  'base64',
);

const created: string[] = [];
test.afterAll(async () => {
  await deleteAccounts(created.splice(0));
});

/**
 * A live election of the test's own, with one party (Partido Ejemplo A) and one criterion: built as its country admin
 * `userId` would, then made live.
 */
const makeLiveElection = async (
  site: { id: string; operatorId?: string | undefined },
  userId: string,
) => {
  await asOwner(
    `WITH e AS (
       INSERT INTO app.elections (tenant_id, slug, type, name)
       VALUES ($1, 'elecciones-de-prueba', 'general', '{"es": "Elecciones de prueba"}') RETURNING id, tenant_id
     ), m AS (
       INSERT INTO app.methodologies (tenant_id, election_id, kind, demands_owner_id, body)
       SELECT tenant_id, id, 'demands', $2, '{"es": "Metodología de ejemplo."}' FROM e RETURNING id
     ), p AS (
       INSERT INTO app.parties (tenant_id, election_id, slug, name, short_name, display_order)
       SELECT tenant_id, id, 'partido-ejemplo-a', '{"es": "Partido Ejemplo A"}', '{"es": "PEA"}', 1 FROM e
     )
     INSERT INTO app.criteria (tenant_id, election_id, slug, title, short_title, description, display_order)
     SELECT tenant_id, id, 'criterio-de-ejemplo-1', '{"es": "Criterio de ejemplo 1"}', '{"es": "Ejemplo 1"}',
            '{"es": "Descripción de ejemplo."}', 1 FROM e`,
    [site.id, site.operatorId],
  );
  await asOwner(
    `DO $$ BEGIN
       PERFORM set_config('app.user_id', '${userId}', true), set_config('app.aal', '2', true);
       UPDATE app.elections SET status = 'live' WHERE tenant_id = '${site.id}';
     END $$`,
  );
};

test.describe('change requests (editorial workflow CR1)', () => {
  test("change a live election's party, several details at once, by proposing and applying, with a note", async ({
    page,
  }) => {
    const site = await createTenant({ operator: true, active: true });
    try {
      const { id } = await signedInAccount(page, created);
      await addMembership(id, site.slug, 'country_admin');
      await makeLiveElection(site, id);
      const election = `${ADMIN_URL}/t/${site.slug}/e/elecciones-de-prueba`;
      await page.goto(`${election}/parties`);
      await page.getByRole('link', { name: 'Partido Ejemplo A' }).click();
      // A live party's details are shown, not edited: they change through a request.
      await expect(page.getByText(en.admin.parties.dataLive)).toBeVisible();
      await page.getByRole('link', { name: en.admin.parties.proposeChange }).click();
      await expect(page.getByRole('heading', { level: 2 })).toHaveText(
        en.admin.changes.form.editTitle,
      );
      // Nothing changed yet: said, and nothing sent.
      await page.getByRole('button', { name: en.admin.changes.form.propose, exact: true }).click();
      await expect(page.getByText(en.admin.changes.form.nothingChanged)).toBeVisible();
      // Several fields at once (PLAN R183), each beside what it is now.
      const next = en.admin.changes.form.next;
      await page
        .getByLabel(
          `${en.admin.changes.labels.name} (${next}) (Spanish, ${en.admin.localized.needed})`,
          { exact: true },
        )
        .fill('Partido Ejemplo A renombrado');
      const colours = page.getByRole('group', {
        name: `${en.admin.changes.labels.colour} (${next})`,
      });
      await colours.getByRole('button', { name: en.admin.form.colour.choose }).click();
      await colours.getByLabel(en.admin.form.colour.code).fill('#123abc');
      await page.locator('input[type="file"]').setInputFiles({
        name: 'logo.png',
        mimeType: 'image/png',
        buffer: PARTY_LOGO_PNG,
      });
      // Each changed field marked, in words: the name, the colour and the logo.
      await expect(
        page.getByText(new RegExp(`^✎ ${en.admin.changes.form.changed}$`, 'u')),
      ).toHaveCount(3);
      const note = page.getByLabel(
        `${en.admin.changes.form.note} (Spanish, ${en.admin.localized.needed})`,
      );
      // Not without its public note: said at the note, which takes focus, and nothing sent (admin forms §1.2).
      await page.getByRole('button', { name: en.admin.changes.form.proposeAndApply }).click();
      await expect(page.getByText(en.admin.form.problems.localized)).toBeVisible();
      await expect(note).toBeFocused();
      await note.fill('Nota inventada: el partido cambió de nombre, de color y de logotipo.');
      await expectAccessible(page);
      await page.getByRole('button', { name: en.admin.changes.form.proposeAndApply }).click();
      await expect(page).toHaveURL(`${election}/changes`);
      await expect(page.locator('#page-announcer')).toHaveText(en.admin.changes.form.applied);
      const decided = page.getByRole('region', { name: en.admin.changes.decided });
      await expect(decided).toContainText('Partido Ejemplo A renombrado');
      await expect(decided).toContainText('#123abc');
      await expect(decided).toContainText(
        'Nota inventada: el partido cambió de nombre, de color y de logotipo.',
      );
      // The new logo, shown as the image it is.
      await expect(
        decided.getByRole('img', {
          name: `${en.admin.changes.labels.logo_file_id}: ${en.admin.changes.proposedValue}`,
        }),
      ).toHaveJSProperty('naturalWidth', 2);
      await expectAccessible(page);
      // One request, one public record, every field applied.
      expect(
        await asOwner(
          `SELECT 1 FROM app.parties p JOIN app.structural_changes s ON s.target_id = p.id
            WHERE p.tenant_id = $1 AND p.name = '{"es": "Partido Ejemplo A renombrado"}'
              AND p.colour = '#123abc' AND p.logo_file_id IS NOT NULL
              AND s.field IS NULL AND s.new_value ->> 'logo_file_id' = p.logo_file_id::text`,
          [site.id],
        ),
      ).toBe(1);
    } finally {
      await purgeTenant(site.id, site.operatorId);
    }
  });

  test("tick a live party's territories from the country's subdivisions, marked as changed (PLAN R201)", async ({
    page,
  }) => {
    // A site in a country ISO lists subdivisions of; the territory ticked is read from the page, not named here.
    const site = await createTenant({ operator: true, active: true, country: 'ES' });
    try {
      const { id } = await signedInAccount(page, created);
      await addMembership(id, site.slug, 'country_admin');
      await makeLiveElection(site, id);
      const election = `${ADMIN_URL}/t/${site.slug}/e/elecciones-de-prueba`;
      await page.goto(`${election}/parties`);
      await page.getByRole('link', { name: 'Partido Ejemplo A' }).click();
      await page.getByRole('link', { name: en.admin.parties.proposeChange }).click();
      const picker = page.getByRole('group', {
        name: `${en.admin.changes.labels.territory_codes} (${en.admin.changes.form.next})`,
      });
      const box = picker.getByRole('checkbox').first();
      const label = (await box.locator('xpath=following-sibling::label').textContent()) ?? '';
      await box.check();
      // Ticked is changed, said in words, as typing is.
      await expect(
        page.getByText(new RegExp(`^✎ ${en.admin.changes.form.changed}$`, 'u')),
      ).toHaveCount(1);
      await page
        .getByLabel(`${en.admin.changes.form.note} (Spanish, ${en.admin.localized.needed})`)
        .fill('Nota inventada: el partido se presenta solo en un territorio.');
      await expectAccessible(page);
      await page.getByRole('button', { name: en.admin.changes.form.proposeAndApply }).click();
      await expect(page).toHaveURL(`${election}/changes`);
      const code = /\(([A-Z]{2}-[A-Z0-9]{1,3})\)$/u.exec(label)?.[1] ?? '';
      expect(
        await asOwner(
          'SELECT 1 FROM app.parties WHERE tenant_id = $1 AND territory_codes = $2::text[]',
          [site.id, [code]],
        ),
      ).toBe(1);
    } finally {
      await purgeTenant(site.id, site.operatorId);
    }
  });
});

test.describe('the corrections log (PLAN R248)', () => {
  test('a country admin takes an entry made by mistake out of the public log, and puts it back', async ({
    page,
  }) => {
    const site = await createTenant({ operator: true, active: true });
    try {
      const { id } = await signedInAccount(page, created);
      await addMembership(id, site.slug, 'country_admin');
      await makeLiveElection(site, id);
      // A slip in the criterion's wording, then the change that put it right.
      for (const text of ['Texto pegado por error.', 'Descripción corregida.']) {
        await asOwner(
          `DO $$ DECLARE request uuid; BEGIN
             PERFORM set_config('app.user_id', '${id}', true), set_config('app.aal', '2', true);
             INSERT INTO app.change_requests (tenant_id, election_id, action, target_kind, target_id, field,
                                              proposed_value, public_note)
             SELECT c.tenant_id, c.election_id, 'update', 'criterion', c.id, 'description', '{"es": "${text}"}',
                    '{"es": "Nota inventada del cambio."}'
               FROM app.criteria c WHERE c.tenant_id = '${site.id}' RETURNING id INTO request;
             UPDATE app.change_requests SET state = 'approved' WHERE id = request;
           END $$`,
        );
      }
      const log = `${ADMIN_URL}/t/${site.slug}/e/elecciones-de-prueba/corrections`;
      await page.goto(log);
      const entries = page.locator('ol > li').filter({ hasText: 'Nota inventada del cambio.' });
      await expect(entries).toHaveCount(2);
      const remove = new RegExp(`^${en.admin.correctionsLog.remove}:`, 'u');
      const restore = new RegExp(`^${en.admin.correctionsLog.restore}:`, 'u');
      // Offered for the slip alone: the change in force stays in the log.
      await expect(page.getByRole('button', { name: remove })).toHaveCount(1);
      await expect(entries.nth(1).getByRole('button', { name: remove })).toBeVisible();
      await entries.nth(1).getByRole('button', { name: remove }).click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toContainText(en.admin.correctionsLog.removeBody);
      await expectAccessible(page);
      await dialog
        .getByRole('button', { name: en.admin.correctionsLog.remove, exact: true })
        .click();
      await expect(page.locator('#page-announcer')).toHaveText(en.admin.correctionsLog.removed);
      await expect(entries.nth(1)).toContainText(en.admin.correctionsLog.mark);
      const inPublic = () =>
        asOwner(
          `SELECT 1 FROM app.corrections_log WHERE tenant_id = $1 AND entry_kind = 'structural_change'`,
          [site.id],
        );
      expect(await inPublic()).toBe(1);
      await expectAccessible(page);
      await entries.nth(1).getByRole('button', { name: restore }).click();
      await dialog
        .getByRole('button', { name: en.admin.correctionsLog.restore, exact: true })
        .click();
      await expect(page.locator('#page-announcer')).toHaveText(en.admin.correctionsLog.restored);
      await expect(page.getByText(en.admin.correctionsLog.mark)).toHaveCount(0);
      expect(await inPublic()).toBe(2);
    } finally {
      await purgeTenant(site.id, site.operatorId);
    }
  });
});
