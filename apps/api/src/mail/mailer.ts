import { createTransport } from 'nodemailer';

import type { MailConfig } from '../config.js';

/** One email, in plain text. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** The display name of the sender: the platform's for account mail, the operator's for a site's (PLAN R115). */
  fromName: string;
  /** Where replies go: the operator's contact address for a site's mail. */
  replyTo?: string | undefined;
  /** RFC 8058 one-click unsubscribe: `List-Unsubscribe` with this URL, and `List-Unsubscribe-Post`. */
  unsubscribeUrl?: string | undefined;
}

export interface Mailer {
  send: (message: MailMessage) => Promise<void>;
}

/** Display names come from data: no line breaks or other controls reach a header, whatever nodemailer encodes. */
const headerText = (value: string): string =>
  value.replaceAll(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').trim();

/**
 * Sends through the platform's one sender (PLAN R115): Mailu's SMTP submission, the platform's address in the
 * envelope and From, with the given display name. A failure rejects, so callers can undo what the email stood for.
 */
export const createMailer = ({ smtpUrl, from }: MailConfig): Mailer => {
  // Seconds, not nodemailer's minutes: a mail server that hangs fails one email, never ties up the API.
  const transport = createTransport({
    url: smtpUrl,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return {
    send: async ({ to, subject, text, fromName, replyTo, unsubscribeUrl }) => {
      await transport.sendMail({
        from: { name: headerText(fromName), address: from },
        to,
        subject: headerText(subject),
        text,
        ...(replyTo ? { replyTo } : {}),
        ...(unsubscribeUrl
          ? {
              list: { unsubscribe: unsubscribeUrl },
              headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
            }
          : {}),
      });
    },
  };
};

/**
 * What may be logged or reported of a sending failure: the SMTP error's code, status and command, never its message,
 * its response or its recipients, which quote the address.
 */
export const mailFailure = (error: unknown): Error => {
  const { code, responseCode, command } = (error ?? {}) as {
    code?: unknown;
    responseCode?: unknown;
    command?: unknown;
  };
  const words = [code, responseCode, command].filter(
    (value): value is string | number => typeof value === 'string' || typeof value === 'number',
  );
  return new Error(`An email could not be sent${words.length > 0 ? `: ${words.join(' ')}` : ''}`);
};
