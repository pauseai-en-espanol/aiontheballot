import { describe, expect, it } from 'vitest';

import { mailFailure } from './mailer.js';

describe('mailFailure', () => {
  it("keeps the SMTP code, status and command, and none of the error's words, which quote the address", () => {
    const error = Object.assign(
      new Error("Can't send mail - all recipients were rejected: 550 <persona@example.org>"),
      {
        code: 'EENVELOPE',
        responseCode: 550,
        command: 'RCPT TO',
        response: '550 5.1.1 <persona@example.org>: Recipient address rejected',
        rejected: ['persona@example.org'],
      },
    );
    const failure = mailFailure(error);
    expect(failure.message).toBe('An email could not be sent: EENVELOPE 550 RCPT TO');
    expect(JSON.stringify(failure)).not.toContain('@');
    expect(failure.stack ?? '').not.toContain('persona');
  });

  it('says only that sending failed for an error with nothing to keep', () => {
    expect(mailFailure(new Error('persona@example.org')).message).toBe(
      'An email could not be sent',
    );
    expect(mailFailure(undefined).message).toBe('An email could not be sent');
  });
});
