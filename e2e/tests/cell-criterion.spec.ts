import { messages } from '@aiontheballot/i18n/messages';

import { addMembership, deleteAccounts, ownerRows } from '../accounts.js';
import { signedInAccount } from '../admin.js';
import { ADMIN_URL } from '../servers.js';
import { expect, test } from '../test.js';

const en = messages.en;

const created: string[] = [];
test.afterAll(async () => {
  await deleteAccounts(created.splice(0));
});

test("a cell's page says what its criterion asks, to a reviewer too (PLAN R240)", async ({
  page,
}) => {
  // A seed cell's party and criterion, and the criterion's description (packages/db/seeds/seed.ts: fictional).
  const [cell] = await ownerRows<{ party: string; criterion: string; description: string }>(
    `SELECT p.id AS party, c.id AS criterion, c.description->>'es' AS description
       FROM app.criteria c
       JOIN app.elections e ON e.id = c.election_id
       JOIN app.tenants t ON t.id = e.tenant_id
       JOIN app.parties p ON p.election_id = e.id
      WHERE t.slug = 'ejemplo-a' AND e.slug = 'generales-de-ejemplo'
        AND c.slug = 'criterio-de-ejemplo-1' AND p.slug = 'partido-ejemplo-a'`,
  );
  expect(cell).toBeDefined();
  const { id } = await signedInAccount(page, created, 'Persona revisora');
  await addMembership(id, 'ejemplo-a', 'reviewer');
  await page.goto(
    `${ADMIN_URL}/t/ejemplo-a/e/generales-de-ejemplo/cells/${cell?.party}/${cell?.criterion}`,
  );
  const asks = page.getByRole('region', { name: en.admin.cells.criterionAsks });
  await expect(asks).toContainText(cell?.description ?? '');
});
