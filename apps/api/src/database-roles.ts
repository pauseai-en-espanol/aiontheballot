import type { Database } from '@aiontheballot/db/client';

import { sql } from 'kysely';

/**
 * Whether a connection logs in as the role its routes assume, and acts as it (PLAN R181): the public routes' as
 * aiontheballot_web, the preview's as aiontheballot_preview. Pointed at the wrong login, one of them would read what it
 * shouldn't (the public routes, an unannounced election in preview), so the server checks each before it listens. The
 * login itself, not only the role it acts as: another login with a role setting in its connection string could change
 * that role back.
 */
export const logsInAs = async (db: Database, role: string): Promise<boolean> => {
  const { rows } = await sql<{ login: string; acting: string }>`
    SELECT session_user AS login, current_user AS acting`.execute(db);
  return rows[0]?.login === role && rows[0]?.acting === role;
};
