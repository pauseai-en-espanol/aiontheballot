import type { DB } from '@aiontheballot/db/generated/db';

import { sql, type Transaction } from 'kysely';

/**
 * How an election's pages are shared (PLAN R239), read in the member's `withActor` transaction (every member of the site
 * reads its counts): each event's total, by channel, by page and by day. Counts only: the database keeps nothing of
 * who shared.
 */
export type ShareEvent = 'share' | 'arrival' | 'preview';

export interface ElectionShares {
  /** The first day counted, or null before anything was. */
  since: string | null;
  totals: Record<ShareEvent, number>;
  /** Each event's channels, most first. */
  channels: { event: ShareEvent; channel: string; count: number }[];
  /** Each page with anything counted, by its path inside the site, the most shared first. */
  pages: ({ path: string } & Record<ShareEvent, number>)[];
  /** The last 30 days, oldest first, every day listed. */
  days: ({ day: string } & Record<ShareEvent, number>)[];
}

const EVENTS: readonly ShareEvent[] = ['share', 'arrival', 'preview'];

const byEvent = (rows: { event: string; count: number | string | bigint }[]) =>
  Object.fromEntries(
    EVENTS.map((event) => [
      event,
      rows.filter((row) => row.event === event).reduce((sum, row) => sum + Number(row.count), 0),
    ]),
  ) as Record<ShareEvent, number>;

export const electionShares = async (
  trx: Transaction<DB>,
  electionId: string,
): Promise<ElectionShares> => {
  const rows = await trx
    .selectFrom('app.share_counts')
    .select(['path', 'event', 'channel', 'day', 'count'])
    .where('election_id', '=', electionId)
    .execute();
  const { rows: window } = await sql<{ day: string }>`
    SELECT to_char(d, 'YYYY-MM-DD') AS day
      FROM generate_series((now() AT TIME ZONE 'UTC')::date - 29, (now() AT TIME ZONE 'UTC')::date, '1 day') d`.execute(
    trx,
  );
  const dayOf = (value: Date | string) =>
    typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
  const channels = new Map<string, { event: ShareEvent; channel: string; count: number }>();
  const pages = new Map<string, { path: string } & Record<ShareEvent, number>>();
  const days = new Map<string, { day: string } & Record<ShareEvent, number>>(
    window.map(({ day }) => [day, { day, share: 0, arrival: 0, preview: 0 }]),
  );
  for (const row of rows) {
    const event = row.event as ShareEvent;
    const key = `${event} ${row.channel}`;
    const channel = channels.get(key) ?? { event, channel: row.channel, count: 0 };
    channel.count += row.count;
    channels.set(key, channel);
    const page = pages.get(row.path) ?? { path: row.path, share: 0, arrival: 0, preview: 0 };
    page[event] += row.count;
    pages.set(row.path, page);
    const day = days.get(dayOf(row.day));
    if (day) {
      day[event] += row.count;
    }
  }
  const first = rows.map((row) => dayOf(row.day)).sort()[0] ?? null;
  return {
    since: first,
    totals: byEvent(rows),
    channels: [...channels.values()].sort(
      (a, b) => b.count - a.count || a.channel.localeCompare(b.channel),
    ),
    pages: [...pages.values()].sort(
      (a, b) =>
        b.share + b.arrival + b.preview - (a.share + a.arrival + a.preview) ||
        a.path.localeCompare(b.path),
    ),
    days: [...days.values()],
  };
};
