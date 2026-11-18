import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { ELECTIONS, TENANT_A, TENANT_B, TENANT_INACTIVE, USERS } from './rls/matrix.js';

const CHECK_VIOLATION = '23514';
const INSUFFICIENT_PRIVILEGE = '42501';

/** A count as the public site sends it: a page's path in the site, the event and its channel. */
const countShare = (
  values: Partial<Record<'tenant' | 'path' | 'event' | 'channel', string>> = {},
): string => {
  const args = {
    tenant: `'${TENANT_A}'`,
    path: `'/${ELECTIONS.liveA.slug}/parties/partido-ejemplo-a'`,
    event: `'share'`,
    channel: `'whatsapp'`,
    ...values,
  };
  return `SELECT app.count_share(tenant => ${args.tenant}, path => ${args.path}, event => ${args.event},
                                 channel => ${args.channel}) AS counted`;
};

const asWeb = async <T>(client: pg.Client, fn: () => Promise<T>): Promise<T> => {
  await client.query('SET LOCAL ROLE aiontheballot_web');
  try {
    return await fn();
  } finally {
    await client.query('RESET ROLE');
  }
};

const counted = async (client: pg.Client, sql: string): Promise<boolean> =>
  (await client.query<{ counted: boolean }>(sql)).rows[0]!.counted;

/** Today's counts of the site, as the owner reads them, without the fixtures' own (each site's live election). */
const today = async (client: pg.Client, tenant = TENANT_A) =>
  (
    await client.query<Record<string, unknown>>(
      `SELECT election_id, path, event, channel, count FROM app.share_counts
        WHERE tenant_id = $1 AND day = (now() AT TIME ZONE 'UTC')::date AND path <> '/generales-de-ejemplo'
        ORDER BY path, event, channel`,
      [tenant],
    )
  ).rows;

describe('counting shares (PLAN R239)', () => {
  it('adds one to the day’s count of an event on a page, by channel, with the page’s election', async () => {
    await inRolledBackTransaction(async (client) => {
      for (let i = 0; i < 3; i += 1) {
        expect(await asWeb(client, () => counted(client, countShare()))).toBe(true);
      }
      expect(await asWeb(client, () => counted(client, countShare({ event: `'arrival'` })))).toBe(
        true,
      );
      expect(await today(client)).toEqual([
        {
          election_id: ELECTIONS.liveA.id,
          path: `/${ELECTIONS.liveA.slug}/parties/partido-ejemplo-a`,
          event: 'arrival',
          channel: 'whatsapp',
          count: 1,
        },
        {
          election_id: ELECTIONS.liveA.id,
          path: `/${ELECTIONS.liveA.slug}/parties/partido-ejemplo-a`,
          event: 'share',
          channel: 'whatsapp',
          count: 3,
        },
      ]);
    });
  });

  it('counts the site’s own pages with no election, and an archived election’s pages with theirs', async () => {
    await inRolledBackTransaction(async (client) => {
      await asWeb(client, () => counted(client, countShare({ path: `'/'`, channel: `'copy'` })));
      await asWeb(client, () =>
        counted(client, countShare({ path: `'/${ELECTIONS.archivedA.slug}/table'` })),
      );
      expect((await today(client)).map(({ election_id, path }) => [election_id, path])).toEqual([
        [null, '/'],
        [ELECTIONS.archivedA.id, `/${ELECTIONS.archivedA.slug}/table`],
      ]);
    });
  });

  it.each([
    ['a page of an election not yet public', { path: `'/${ELECTIONS.draftA.slug}/table'` }],
    ['a site that is not active', { tenant: `'${TENANT_INACTIVE}'`, path: `'/'` }],
    ['a site that does not exist', { tenant: `'${USERS.newcomer}'`, path: `'/'` }],
  ])('counts nothing for %s', async (_name, values) => {
    await inRolledBackTransaction(async (client) => {
      expect(await asWeb(client, () => counted(client, countShare(values)))).toBe(false);
      expect(await today(client)).toEqual([]);
      expect(await today(client, TENANT_INACTIVE)).toEqual([]);
    });
  });

  it.each([
    ['an event it doesn’t know', { event: `'like'` }],
    ['a channel it doesn’t know', { channel: `'myspace'` }],
    [
      'an arrival through the copy button, which adds no channel to the address',
      {
        event: `'arrival'`,
        channel: `'copy'`,
      },
    ],
    ['a preview drawn by the share sheet', { event: `'preview'`, channel: `'native'` }],
    ['a path that is not one', { path: `'/../aviso-legal'` }],
    ['a path with an address in it', { path: `'/https://otro.example.org'` }],
    ['an empty path', { path: `''` }],
    ['an endless path', { path: `'/${'a'.repeat(200)}'` }],
  ])('refuses %s', async (_name, values) => {
    expect(
      await inRolledBackTransaction((c) => asWeb(c, () => errorCode(c, countShare(values)))),
    ).toBe(CHECK_VIOLATION);
  });

  it('stops counting a site for the day past 100,000, without an error', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(
        `INSERT INTO app.share_counts (tenant_id, path, event, channel, day, count)
         VALUES ($1, '/', 'preview', 'other', (now() AT TIME ZONE 'UTC')::date, 100000)`,
        [TENANT_A],
      );
      expect(await asWeb(client, () => counted(client, countShare()))).toBe(false);
      // Another site counts on.
      expect(
        await asWeb(client, () =>
          counted(client, countShare({ tenant: `'${TENANT_B}'`, path: `'/'` })),
        ),
      ).toBe(true);
    });
  });

  it('is only the public site’s: the admin and the worker can’t count', async () => {
    for (const role of ['aiontheballot_admin', 'aiontheballot_worker']) {
      expect(
        await inRolledBackTransaction(async (client) => {
          await client.query(`SET LOCAL ROLE ${role}`);
          return errorCode(client, countShare());
        }),
        role,
      ).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });
});
