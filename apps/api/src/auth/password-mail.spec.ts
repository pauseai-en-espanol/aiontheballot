import { describe, expect, it } from 'vitest';

import type { MailMessage } from '../mail/mailer.js';

import { createPasswordMail } from './password-mail.js';

const ORIGIN = 'https://admin.example.test';

const mailWith = () => {
  const sent: MailMessage[] = [];
  const mail = createPasswordMail({
    mailer: { send: async (message) => void sent.push(message) },
    adminOrigin: ORIGIN,
    platformName: 'Plataforma de ejemplo',
  });
  return { mail, sent };
};

describe('password recovery mail (PLAN R170)', () => {
  it("sends the link with its token in the fragment, from the platform, in the page's language", async () => {
    const { mail, sent } = mailWith();
    await mail.link({ email: 'persona@example.org', token: 'a+b/c', locale: 'es' });
    expect(sent).toHaveLength(1);
    const [message] = sent as [MailMessage];
    expect(message).toMatchObject({
      to: 'persona@example.org',
      fromName: 'Plataforma de ejemplo',
      subject: 'Elige una contraseña nueva para Plataforma de ejemplo',
    });
    expect(message.replyTo).toBeUndefined();
    expect(message.text).toContain(`${ORIGIN}/set-password#token=a%2Bb%2Fc`);
    expect(message.text).not.toContain('?token=');
  });

  it('names the manager who sent it from the members page, as plain text', async () => {
    const { mail, sent } = mailWith();
    await mail.link({
      email: 'persona@example.org',
      token: 't',
      locale: 'en',
      by: { name: 'Ana‮ https://evil.test Ejemplo', site: 'Sitio de ejemplo' },
    });
    const [message] = sent as [MailMessage];
    expect(message.text).toContain('Ana Ejemplo, who manages the members of Sitio de ejemplo');
    expect(message.text).not.toContain('evil.test');
    expect(message.text).toContain("They don't see the link or your password.");
  });

  it('calls a manager without a name "Someone"', async () => {
    const { mail, sent } = mailWith();
    await mail.link({
      email: 'persona@example.org',
      token: 't',
      locale: 'en',
      by: { name: '', site: 'Sitio de ejemplo' },
    });
    expect((sent as [MailMessage])[0].text).toContain('Someone, who manages the members');
  });

  it('tells the account its password was changed, with where to choose another', async () => {
    const { mail, sent } = mailWith();
    await mail.changed({ email: 'persona@example.org', locale: 'en' });
    const [message] = sent as [MailMessage];
    expect(message.subject).toBe('Your password for Plataforma de ejemplo was changed');
    expect(message.text).toContain(`${ORIGIN}/forgot-password`);
    expect(message.text).toContain('signing in still asks for the code');
  });

  it('tells an account with no second factor that whoever signs in next sets one up (D19)', async () => {
    const { mail, sent } = mailWith();
    await mail.changed({ email: 'persona@example.org', locale: 'en', enrolled: false });
    const [message] = sent as [MailMessage];
    expect(message.subject).toBe('Your password for Plataforma de ejemplo was changed');
    expect(message.text).toContain('whoever signs in next with the new password sets one up');
    // Neither a link sent to the mailbox, nor a way to reset through it: an account with no factor gets none.
    expect(message.text).not.toContain('a link sent to this address');
    expect(message.text).not.toContain('/forgot-password');
  });
});
