import type { Locale } from '@aiontheballot/i18n/catalog';

import { LOCALE_COOKIE, pickLocale } from '@aiontheballot/i18n/negotiate';
import { cookies, headers } from 'next/headers';

// The switch's route sets the cookie this reads.
export { LOCALE_COOKIE } from '@aiontheballot/i18n/negotiate';

export const getLocale = async (): Promise<Locale> =>
  pickLocale((await cookies()).get(LOCALE_COOKIE)?.value, (await headers()).get('accept-language'));

// A path's own characters and well-formed escapes only (RFC 3986), so nothing a browser drops or rewrites when it reads
// a Location (tabs, newlines, backslashes) can turn it into `//another-host`, and nothing a header can't carry gets that
// far.
const PATH = /^\/(?!\/)(?:[\w\-.~!$&'()*+,;=:@/]|%[\da-f]{2})*$/i;
const MAX_PATH = 2048;

/** Where to go back to: a path on this host only, never another site (`//host`, `/\host`). */
export const backTo = (value: unknown): string =>
  typeof value === 'string' && value.length <= MAX_PATH && PATH.test(value) ? value : '/';
