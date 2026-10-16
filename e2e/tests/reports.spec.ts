import { messages } from '@aiontheballot/i18n/messages';
import { randomUUID } from 'node:crypto';

import { addMembership, asOwner, deleteAccounts } from '../accounts.js';
import { signedInAccount } from '../admin.js';
import { expectAccessible } from '../axe.js';
import { send } from '../fetch-by-host.js';
import { ADMIN_URL, PREVIEW_URL } from '../servers.js';
import { expect, test } from '../test.js';

const es = messages.es;
const en = messages.en;
/** Tenant ejemplo-a's election on the preview host (its canonical host is coming soon in the seeds). */
const ELECTION = `${PREVIEW_URL}/ejemplo-a/generales-de-ejemplo`;

const created: string[] = [];
const marker = `e2e-${randomUUID()}`;
test.afterAll(async () => {
  await asOwner(`DELETE FROM app.reports WHERE message LIKE $1`, [`%${marker}%`]);
  await deleteAccounts(created.splice(0));
});

test.describe('the right of reply, end to end (PLAN R149)', () => {
  test('a visitor reports a mistake in a cell; a member triages it and accepts it', async ({
    browser,
  }) => {
    // The visitor and the member are two people: two browsers' worth of cookies, the visitor's none.
    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto(`${ELECTION}/partidos/partido-ejemplo-a/criterio-de-ejemplo-1`);
    await visitor.getByRole('link', { name: es.reportPage.link }).click();
    await expect(visitor.getByRole('heading', { level: 1 })).toHaveText(es.reportPage.title);
    await expect(visitor.getByText(/^Sobre: Partido Ejemplo A/)).toBeVisible();
    await expect(visitor.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expectAccessible(visitor);
    await visitor.getByLabel(es.reportPage.kinds.error_report).check();
    await visitor
      .getByLabel(es.reportPage.message)
      .fill(`Un error inventado en la valoración (${marker}).`);
    await visitor.getByLabel(es.reportPage.name).fill('Persona de Ejemplo');
    await visitor.getByLabel(es.reportPage.email).fill('persona@ejemplo.test');
    // A person takes a few seconds to write; the form refuses, silently, anything faster (report-route.ts).
    await visitor.waitForTimeout(3_200);
    await visitor.getByRole('button', { name: es.reportPage.submit }).click();
    await expect(visitor.getByRole('status')).toHaveText(es.reportPage.outcome.sent);
    expect(
      await asOwner(
        `SELECT 1 FROM app.reports WHERE message LIKE $1 AND assessment_id IS NOT NULL AND email = 'persona@ejemplo.test'`,
        [`%${marker}%`],
      ),
    ).toBe(1);

    // A reviewer of the site triages it in the admin, in English (the admin's own language by default).
    const page = await (await browser.newContext()).newPage();
    const { id } = await signedInAccount(page, created);
    await addMembership(id, 'ejemplo-a', 'reviewer');
    await page.goto(`${ADMIN_URL}/t/ejemplo-a`);
    await page.getByRole('link', { name: en.admin.shell.reports }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.admin.reports.title);
    const card = page.getByRole('listitem').filter({ hasText: marker });
    await expect(card).toContainText('Partido Ejemplo A');
    await card
      .getByRole('link', {
        name: `${en.admin.reports.statuses.new} · ${en.admin.reports.kinds.error_report}`,
      })
      .click();
    await expect(page.getByText(`Un error inventado en la valoración (${marker}).`)).toBeVisible();
    await expect(page.getByText('persona@ejemplo.test')).toBeVisible();
    await expectAccessible(page);
    // Each choice says what it means, and a decision can be taken at once, from new (admin forms §2, PLAN R196).
    const accepted = page.getByRole('radio', { name: en.admin.reports.statuses.accepted });
    await expect(accepted).toHaveAccessibleDescription(en.admin.reports.meanings.accepted);
    await expect(page.getByRole('link', { name: en.admin.reports.proposeChange })).toHaveAttribute(
      'href',
      /\/changes$/u,
    );
    await accepted.check();
    await page
      .getByLabel(en.admin.reports.triage.note)
      .fill('Lo corregimos en la próxima revisión.');
    await page.getByRole('button', { name: en.admin.reports.triage.save }).click();
    await expect(page.getByRole('status')).toHaveText(en.admin.reports.triage.saved);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      en.admin.reports.statuses.accepted,
    );
    // Only country admins remove personal data: a reviewer isn't offered it.
    await expect(page.getByRole('button', { name: en.admin.reports.anonymize.button })).toHaveCount(
      0,
    );
  });

  test("answers a bot as if it were sent, and keeps nothing; refuses another site's post", async () => {
    const form = (fields: Record<string, string>) => ({
      kind: 'error_report',
      message: `Un mensaje de un bot inventado (${marker}).`,
      t: String(Date.now() - 10_000),
      website: '',
      ...fields,
    });
    const filled = await send('POST', `${ELECTION}/informar/enviar`, {
      headers: { 'sec-fetch-site': 'same-origin' },
      form: form({ website: 'https://spam.example.test' }),
    });
    expect(filled.status).toBe(303);
    expect(filled.headers.location).toContain('enviado=sent');
    const fast = await send('POST', `${ELECTION}/informar/enviar`, {
      headers: { 'sec-fetch-site': 'same-origin' },
      form: form({ t: String(Date.now()) }),
    });
    expect(fast.headers.location).toContain('enviado=sent');
    expect(
      await asOwner(`SELECT 1 FROM app.reports WHERE message LIKE $1`, [
        `%bot inventado (${marker})%`,
      ]),
    ).toBe(0);
    const crossSite = await send('POST', `${ELECTION}/informar/enviar`, {
      headers: { 'sec-fetch-site': 'cross-site' },
      form: form({}),
    });
    expect(crossSite.status).toBe(403);
  });
});
