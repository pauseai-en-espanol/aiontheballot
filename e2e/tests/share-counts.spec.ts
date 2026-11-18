import { messages } from '@aiontheballot/i18n/messages';

import { addMembership, asOwner, deleteAccounts, ownerRows } from '../accounts.js';
import { signedInAccount } from '../admin.js';
import { get, send } from '../fetch-by-host.js';
import { ADMIN_URL, TENANT_URL } from '../servers.js';
import { expect, test } from '../test.js';

const en = messages.en;

const created: string[] = [];
test.afterAll(async () => {
  await deleteAccounts(created.splice(0));
});

/** Today's count of an event on a page of ejemplo-a, as the owner reads it. */
const countOf = async (path: string, event: string, channel: string): Promise<number> =>
  (
    await ownerRows<{ count: number }>(
      `SELECT coalesce(sum(c.count), 0)::int AS count FROM app.share_counts c
         JOIN app.tenants t ON t.id = c.tenant_id
        WHERE t.slug = 'ejemplo-a' AND c.path = $1 AND c.event = $2 AND c.channel = $3
          AND c.day = (now() AT TIME ZONE 'UTC')::date`,
      [path, event, channel],
    )
  )[0]?.count ?? 0;

test.describe("how a site's pages are shared (PLAN R239)", () => {
  test("counts a network's crawler drawing a link preview, and nothing for a visitor", async () => {
    const before = await countOf('/', 'preview', 'whatsapp');
    // The coming-soon home: the one page served before the site opens.
    expect((await get(`${TENANT_URL}/`, { 'user-agent': 'WhatsApp/2.23.20.0 A' })).status).toBe(
      200,
    );
    await expect.poll(() => countOf('/', 'preview', 'whatsapp')).toBe(before + 1);
    expect(
      (await get(`${TENANT_URL}/`, { 'user-agent': 'Mozilla/5.0 Safari/605.1.15' })).status,
    ).toBe(200);
    expect(await countOf('/', 'preview', 'whatsapp')).toBe(before + 1);
  });

  test("counts a share sent from the site's own page through the relay, and none from another", async () => {
    const before = await countOf('/', 'share', 'copy');
    const relay = (origin: string) =>
      send('POST', `${TENANT_URL}/_relay/shares`, {
        headers: { origin },
        json: { u: `${TENANT_URL}/`, event: 'share', channel: 'copy' },
      });
    expect((await relay(TENANT_URL)).status).toBe(204);
    await expect.poll(() => countOf('/', 'share', 'copy')).toBe(before + 1);
    expect((await relay('https://otro.example.test')).status).toBe(403);
    expect(await countOf('/', 'share', 'copy')).toBe(before + 1);
  });

  test("shows an election's counts to every member in the admin, by event, channel, page and day", async ({
    page,
  }) => {
    const path = '/generales-de-ejemplo/parties/partido-ejemplo-recuento';
    await asOwner(
      `INSERT INTO app.share_counts (tenant_id, election_id, path, event, channel, day, count)
       SELECT e.tenant_id, e.id, $1, 'share', 'telegram', (now() AT TIME ZONE 'UTC')::date - 2, 7
         FROM app.elections e JOIN app.tenants t ON t.id = e.tenant_id
        WHERE t.slug = 'ejemplo-a' AND e.slug = 'generales-de-ejemplo'`,
      [path],
    );
    try {
      const { id } = await signedInAccount(page, created, 'Persona de difusión');
      await addMembership(id, 'ejemplo-a', 'reviewer');
      await page.goto(`${ADMIN_URL}/t/ejemplo-a/e/generales-de-ejemplo`);
      await page.getByRole('link', { name: en.admin.election.shares }).click();
      await expect(
        page.getByRole('heading', { name: en.sharesPage.title, level: 2 }),
      ).toBeVisible();
      const byPage = page.getByRole('table').nth(1);
      const row = byPage.getByRole('row').filter({ hasText: path });
      await expect(row).toContainText('7');
      const byChannel = page.getByRole('table').first();
      await expect(byChannel.getByRole('row').filter({ hasText: 'Telegram' })).toBeVisible();
    } finally {
      await asOwner(`DELETE FROM app.share_counts WHERE path = $1`, [path]);
    }
  });
});
