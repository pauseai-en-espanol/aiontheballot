import type { Database } from '@aiontheballot/db/client';

import { sql } from 'kysely';

/**
 * How a site's pages are shared (PLAN R239): the public site counts each event through app.count_share, which only
 * aiontheballot_web may execute. Counts only: nothing about who shared, from where or with whom reaches the database.
 */

/** The events counted, each with its channels, as the database's checks take them. */
export const SHARE_CHANNELS = {
  share: [
    'whatsapp',
    'telegram',
    'x',
    'facebook',
    'bluesky',
    'linkedin',
    'email',
    'copy',
    'native',
    'download',
    'image',
  ],
  arrival: ['whatsapp', 'telegram', 'x', 'facebook', 'bluesky', 'linkedin', 'email'],
  preview: [
    'whatsapp',
    'telegram',
    'x',
    'facebook',
    'bluesky',
    'linkedin',
    'slack',
    'discord',
    'other',
  ],
} as const;

export type ShareEvent = keyof typeof SHARE_CHANNELS;

export interface ShareCount {
  /** The page's path inside the site, the same in every language: `/29n/parties/partido-ejemplo-a`. */
  path: string;
  event: ShareEvent;
  channel: string;
}

/** A path as the database takes it: slugs under the site's root, or the root itself. */
const PATH = /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/;

export const isShareCount = (value: ShareCount): boolean =>
  value.path.length <= 200 &&
  PATH.test(value.path) &&
  value.event in SHARE_CHANNELS &&
  (SHARE_CHANNELS[value.event] as readonly string[]).includes(value.channel);

/**
 * Counts one event on a site's page, as aiontheballot_web. Whether it counted: not for a site that isn't there or
 * isn't active, a page of an election not yet public, or past the site's daily cap; the public hears nothing either way.
 */
export const countShare = async (
  db: Database,
  slug: string,
  { path, event, channel }: ShareCount,
): Promise<boolean> => {
  const { rows } = await sql<{ counted: boolean }>`
    SELECT app.count_share(t.id, ${path}, ${event}, ${channel}) AS counted
      FROM app.tenants t WHERE t.slug = ${slug}`.execute(db);
  return rows[0]?.counted ?? false;
};
