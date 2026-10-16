import {
  addMembership,
  asOwner,
  createTenant,
  deleteAccounts,
  ownerRows,
  purgeTenant,
} from '../accounts.js';
import { signedInAccount } from '../admin.js';
import { get, send } from '../fetch-by-host.js';
import { ADMIN_URL, PLATFORM_HOST, PORTS, SEED_HOSTS } from '../servers.js';
import { expect, test } from '../test.js';

const created: string[] = [];
test.afterAll(async () => {
  await deleteAccounts(created.splice(0));
});

/** Waits, a quarter-second at a time, until `check` holds or `ms` have passed: what the public sees, as it sees it. */
const within = async (ms: number, check: () => Promise<boolean>): Promise<boolean> => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
};

test.describe('instant refresh on publish (R151)', () => {
  test('a change applied in the admin shows on the public site in seconds, not the minute its copies last', async ({
    page,
  }) => {
    const site = await createTenant({ operator: true, active: true });
    try {
      const { id } = await signedInAccount(page, created);
      await addMembership(id, site.slug, 'country_admin');
      // An open site of the test's own, with a live election, reachable on the platform host by its path.
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
           PERFORM set_config('app.user_id', '${id}', true), set_config('app.aal', '2', true);
           UPDATE app.elections SET status = 'live' WHERE tenant_id = '${site.id}';
         END $$`,
      );
      // Opening a site and its approvals are a platform admin's settings: the test's account is one too.
      await asOwner('INSERT INTO app.platform_admins (user_id) VALUES ($1)', [id]);
      await asOwner(
        `DO $$ BEGIN
           PERFORM set_config('app.user_id', '${id}', true), set_config('app.aal', '2', true);
           UPDATE app.tenants SET site_open = true, live_edits_need_second_approver = false
            WHERE id = '${site.id}';
         END $$`,
      );
      const scorecard = `http://${PLATFORM_HOST}:${PORTS.web}/${site.slug}/elecciones-de-prueba`;
      // The web learns of the new site as the API would tell it: on its internal address only.
      const told = await send('POST', `http://127.0.0.1:${PORTS.web}/_internal/revalidate`, {
        json: { tenant: site.slug },
      });
      expect(told.status).toBe(202);
      expect(
        await within(5_000, async () =>
          (await get(scorecard)).body.toString('utf8').includes('Elecciones de prueba'),
        ),
      ).toBe(true);

      // The country admin renames the election, proposing and applying at once (the site needs no second approver).
      const [{ id: election } = { id: '' }] = await ownerRows<{ id: string }>(
        'SELECT id FROM app.elections WHERE tenant_id = $1',
        [site.id],
      );
      const renamed = await page.request.post(
        `${ADMIN_URL}/api/t/${site.slug}/e/elecciones-de-prueba/changes`,
        {
          headers: { origin: ADMIN_URL },
          data: {
            action: 'update',
            targetKind: 'election',
            targetId: election,
            field: 'name',
            value: { es: 'Elecciones de prueba renombradas' },
            publicNote: { es: 'Una nota pública inventada sobre el nombre.' },
            apply: true,
          },
        },
      );
      expect(renamed.status()).toBe(201);
      expect(
        await within(5_000, async () =>
          (await get(scorecard)).body.toString('utf8').includes('Elecciones de prueba renombradas'),
        ),
      ).toBe(true);
    } finally {
      await purgeTenant(site.id, site.operatorId);
    }
  });

  test('is no page on a public host, where the gateway would bring it', async () => {
    const answer = await send(
      'POST',
      `http://${SEED_HOSTS.canonical}:${PORTS.web}/_internal/revalidate`,
      {
        json: { tenant: 'ejemplo-a' },
      },
    );
    expect(answer.status).toBe(404);
  });
});
