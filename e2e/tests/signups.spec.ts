import { messages } from '@aiontheballot/i18n/messages';
import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import pg from 'pg';

import { expectAccessible } from '../axe.js';
import { get, send } from '../fetch-by-host.js';
import { mailFor } from '../mail.js';
import { PLATFORM_HOST, PORTS, TENANT_URL } from '../servers.js';

if (existsSync('../.env')) {
  process.loadEnvFile('../.env');
}

const es = messages.es;

/** Tenant ejemplo-b, by path on the platform host: no published privacy policy, so no signup form. */
const TENANT_B = `http://${PLATFORM_HOST}:${PORTS.web}/ejemplo-b`;

/** The canonical address an email's links carry, onto this run's web server. */
const local = (url: string) => url.replace('https://ejemplo-a.localhost', TENANT_URL);

const linkIn = (text: string, path: string) => {
  const match = new RegExp(`https://ejemplo-a\\.localhost${path}\\?t=[\\w-]{43}`).exec(text);
  expect(match, `a ${path} link in the email`).not.toBeNull();
  return local(match?.[0] ?? '');
};

/** A signup's state, read as the tables' owner (DATABASE_URL), which RLS doesn't filter. */
const signupOf = async (email: string) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ confirmed: boolean; future: boolean }>(
      `SELECT confirmed_at IS NOT NULL AS confirmed, future_elections AS future FROM app.signups WHERE email = $1`,
      [email],
    );
    return rows[0];
  } finally {
    await client.end();
  }
};

const waitForMail = async (email: string) => {
  await expect.poll(async () => (await mailFor(email)).length).toBe(1);
  const [mail] = await mailFor(email);
  if (!mail) {
    throw new Error('No email');
  }
  return mail;
};

test.describe('the signup list (PLAN R119)', () => {
  test('is offered once the site has a published privacy policy and mail can be sent, the box unticked', async ({
    page,
  }) => {
    await page.goto(TENANT_URL);
    const form = page.locator('#avisos');
    await expect(form.getByRole('heading', { name: es.signup.title })).toBeVisible();
    await expect(form.getByLabel(es.signup.email)).toHaveAttribute('type', 'email');
    await expect(form.getByLabel(es.signup.future)).not.toBeChecked();
    await expect(form.getByRole('link', { name: es.signup.privacyLink })).toHaveAttribute(
      'href',
      '/privacidad',
    );
    await expect(form.getByText(es.signup.how)).toBeVisible();
    await expectAccessible(page);

    await page.goto(TENANT_B);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inquilino de ejemplo B');
    await expect(page.locator('#avisos')).toHaveCount(0);
  });

  test('confirms only when the person presses the button, then unsubscribes with one click', async ({
    page,
  }) => {
    const email = `suscripcion-${crypto.randomUUID()}@example.org`;
    await page.goto(TENANT_URL);
    await page.getByLabel(es.signup.email).fill(email);
    await page.getByLabel(es.signup.future).check();
    await page.getByRole('button', { name: es.signup.submit }).click();
    await expect(page).toHaveURL(/\?aviso=accepted#avisos$/);
    await expect(page.getByRole('status')).toHaveText(es.signup.outcome.accepted);

    const mail = await waitForMail(email);
    // In the operator's name, replies to its contact address (PLAN R115), from the platform's one sender.
    expect(mail.headers.from).toBe('Organización de ejemplo A <avisos@plataforma.example>');
    expect(mail.headers['reply-to']).toBe('contacto@organizacion-ejemplo-a.example');
    expect(mail.headers['list-unsubscribe-post']).toBe('List-Unsubscribe=One-Click');
    const oneClick = /<([^>]+)>/.exec(mail.headers['list-unsubscribe'] ?? '')?.[1] ?? '';
    expect(oneClick).toMatch(
      /^https:\/\/ejemplo-a\.localhost\/avisos\?action=unsubscribe&t=[\w-]{43}$/,
    );
    expect(mail.text).toContain('y de futuras elecciones en él');

    // Following the link (as a mail scanner would) confirms nothing.
    const confirm = linkIn(mail.text, '/avisos/confirmar');
    await page.goto(confirm);
    await page.goto(confirm);
    expect(await signupOf(email)).toEqual({ confirmed: false, future: true });
    await expectAccessible(page);
    await page.getByRole('button', { name: es.confirm.button }).click();
    await expect(page).toHaveURL(/\/avisos\/confirmar\?r=ok$/);
    await expect(page.getByRole('status')).toHaveText(
      es.confirm.done.replace('{site}', 'Inquilino de ejemplo A'),
    );
    expect(await signupOf(email)).toEqual({ confirmed: true, future: true });

    // A mail client's one-click unsubscribe (RFC 8058): a post from no page at all.
    const response = await send('POST', local(oneClick), {
      form: { 'List-Unsubscribe': 'One-Click' },
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(response.status).toBe(200);
    expect(await signupOf(email)).toBeUndefined();

    // The email's own link now says there's nothing to delete.
    await page.goto(linkIn(mail.text, '/avisos/baja'));
    await page.getByRole('button', { name: es.unsubscribe.button }).click();
    await expect(page.getByRole('status')).toHaveText(es.unsubscribe.invalid);
  });

  test('says the same for an address already on the list, confirmed or not, and emails it nothing more', async ({
    page,
  }) => {
    const email = `repetida-${crypto.randomUUID()}@example.org`;
    const signUp = async () => {
      await page.goto(TENANT_URL);
      await page.getByLabel(es.signup.email).fill(email);
      await page.getByRole('button', { name: es.signup.submit }).click();
      await expect(page.getByRole('status')).toHaveText(es.signup.outcome.accepted);
    };
    await signUp();
    const mail = await waitForMail(email);
    // Unconfirmed, emailed a moment ago: the same answer, no second email.
    await signUp();
    await page.goto(linkIn(mail.text, '/avisos/confirmar'));
    await page.getByRole('button', { name: es.confirm.button }).click();
    await expect(page.getByRole('status')).toHaveText(
      es.confirm.done.replace('{site}', 'Inquilino de ejemplo A'),
    );
    // Confirmed: the same answer again, and still one email.
    await signUp();
    await page.waitForTimeout(500);
    expect(await mailFor(email)).toHaveLength(1);
  });

  test("refuses another site's form: signing up takes a post from the site's own pages", async () => {
    const response = await send('POST', `${TENANT_URL}/avisos`, {
      form: { email: `ajena-${crypto.randomUUID()}@example.org` },
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(response.status).toBe(403);
  });
});

test.describe("the site's always-on pages", () => {
  test('the legal notice and the privacy policy, linked from every page, before the site opens', async ({
    page,
  }) => {
    await page.goto(TENANT_URL);
    const footer = page.locator('footer');
    await footer.getByRole('link', { name: es.layout.legalNotice }).click();
    await expect(page).toHaveURL(`${TENANT_URL}/aviso-legal`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(es.legal.title);
    await expect(page.getByText('Organización de Ejemplo A', { exact: true })).toBeVisible();
    await expect(page.locator('[data-invariant="operator-line"]')).toBeVisible();
    await expectAccessible(page);

    await page.locator('footer').getByRole('link', { name: es.layout.privacy }).click();
    await expect(page).toHaveURL(`${TENANT_URL}/privacidad`);
    await expect(page.getByText('Política de privacidad de ejemplo.')).toBeVisible();
    await expectAccessible(page);
  });

  test("a policy text that isn't published, and the app's own English words, are no page", async () => {
    for (const path of ['/quienes-somos', '/privacy', '/legal-notice', '/avisos/confirm']) {
      expect((await get(`${TENANT_URL}${path}`)).status, path).toBe(404);
    }
    expect((await get(`${TENANT_B}/privacidad`)).status).toBe(404);
  });

  test("an election's pages wait until the site opens", async () => {
    expect((await get(`${TENANT_URL}/generales-de-ejemplo`)).status).toBe(404);
  });
});
