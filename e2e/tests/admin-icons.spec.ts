import { ADMIN_URL } from '../servers.js';
import { expect, test } from '../test.js';

test.describe("the admin's icons (PLAN R154)", () => {
  test('are named by every page and served from the production build', async ({ request }) => {
    const page = await (await request.get(`${ADMIN_URL}/sign-in`)).text();
    for (const [link, type] of [
      [/<link rel="icon" href="\/icon-32\.png" sizes="32x32" type="image\/png"/u, 'image/png'],
      [/<link rel="shortcut icon" href="\/favicon\.ico"/u, 'image/x-icon'],
      [/<link rel="apple-touch-icon" href="\/apple-touch-icon\.png"/u, 'image/png'],
    ] as const) {
      expect(page).toMatch(link);
      const path = /href="([^"]+)"/u.exec(link.source.replaceAll('\\', ''))?.[1] ?? '';
      const icon = await request.get(`${ADMIN_URL}${path}`);
      expect(icon.status(), path).toBe(200);
      expect(icon.headers()['content-type'], path).toBe(type);
      expect((await icon.body()).byteLength, path).toBeGreaterThan(100);
    }
  });
});
