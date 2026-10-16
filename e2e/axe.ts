import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** WCAG 2.2 AA, as far as axe can tell (editorial workflow §2.6). */
export const expectAccessible = async (page: Page) => {
  // A page redrawn in place after a save (`router.refresh`) streams its title back in, so for a moment it has none:
  // axe looks once that redraw has landed (its request done, the title back). A page that never gets a title still
  // fails, here or in axe.
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveTitle(/\S/);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => String(n.target)).join(', ')}`),
  ).toEqual([]);
};
