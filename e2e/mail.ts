import { MAILBOX_URL } from './servers.js';

export interface Mail {
  to: string[];
  /** Header names in lower case, values unfolded and decoded. */
  headers: Record<string, string>;
  /** The plain-text body, decoded. */
  text: string;
}

/** RFC 2047 encoded words (`=?UTF-8?Q?…?=`, `=?UTF-8?B?…?=`), as nodemailer writes names and subjects. */
const decodeWords = (value: string): string =>
  value
    .replaceAll(/\?=\s+=\?/g, '?==?')
    .replaceAll(
      /=\?([^?]+)\?([QB])\?([^?]*)\?=/gi,
      (_match, _charset: string, encoding: string, text: string) =>
        encoding.toUpperCase() === 'B'
          ? Buffer.from(text, 'base64').toString('utf8')
          : decodeQuotedPrintable(text.replaceAll('_', ' ')),
    );

const decodeQuotedPrintable = (text: string): string =>
  Buffer.from(
    text
      .replaceAll(/=\r?\n/g, '')
      .replaceAll(/=([0-9A-F]{2})/gi, (_match, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      ),
    'latin1',
  ).toString('utf8');

const parse = ({ to, data }: { to: string[]; data: string }): Mail => {
  const split = data.indexOf('\r\n\r\n');
  const head = data.slice(0, split).replaceAll(/\r\n[ \t]+/g, ' ');
  const body = data.slice(split + 4);
  const headers: Record<string, string> = {};
  for (const line of head.split('\r\n')) {
    const colon = line.indexOf(':');
    headers[line.slice(0, colon).toLowerCase()] = decodeWords(line.slice(colon + 1).trim());
  }
  const encoding = headers['content-transfer-encoding']?.toLowerCase();
  const text =
    encoding === 'quoted-printable'
      ? decodeQuotedPrintable(body)
      : encoding === 'base64'
        ? Buffer.from(body.replaceAll(/\s/g, ''), 'base64').toString('utf8')
        : body;
  return { to, headers, text: text.replaceAll('\r\n', '\n') };
};

/** Every message the stand-in SMTP server received for `address`, oldest first. */
export const mailFor = async (address: string): Promise<Mail[]> => {
  const response = await fetch(`${MAILBOX_URL}/received`);
  const received = (await response.json()) as { to: string[]; data: string }[];
  return received.filter((message) => message.to.includes(address)).map(parse);
};
