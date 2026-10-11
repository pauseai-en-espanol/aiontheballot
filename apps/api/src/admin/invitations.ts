import type { Database } from '@aiontheballot/db/client';
import type { DB } from '@aiontheballot/db/generated/db';

import { getTranslator, type Locale } from '@aiontheballot/i18n/messages';
import { sql, type Transaction } from 'kysely';
import { createHash, randomBytes } from 'node:crypto';

import type { Mailer } from '../mail/mailer.js';
import type { TenantRole } from './access.js';

/**
 * Invitations (editorial workflow A2, A3; PLAN R114): created, listed, revoked and deleted by country admins and
 * platform admins under RLS, in the caller's `withActor` transaction; looked up and accepted through the two narrow
 * functions the database keeps for that. A token is 256 random bits, base64url, carried in the link's fragment; the
 * database holds only its SHA-256, and only that ever reaches it.
 */

/** An invitation expires after this long (A2.3); the database refuses more than 30 days. */
export const INVITATION_DAYS = 7;

export type InvitationState = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface Invitation {
  id: string;
  email: string;
  role: TenantRole;
  createdAt: string;
  expiresAt: string;
  state: InvitationState;
}

export const makeInvitationToken = (): string => randomBytes(32).toString('base64url');

export const hashInvitationToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/** Where the invited person accepts: the token in the fragment, which browsers send to no server (R93). */
export const invitationLink = (adminOrigin: string, token: string): string =>
  `${adminOrigin}/invitation#token=${encodeURIComponent(token)}`;

const instant = (column: string) => sql<string>`to_json(${sql.ref(column)})#>>'{}'`;

/** The tenant's invitations RLS shows the actor (country admins' and platform admins'), newest first. */
export const listInvitations = async (
  trx: Transaction<DB>,
  tenantId: string,
): Promise<Invitation[]> => {
  const rows = await trx
    .selectFrom('app.invitations')
    .select([
      'id',
      'email',
      'role',
      instant('created_at').as('created_at'),
      instant('expires_at').as('expires_at'),
      sql<InvitationState>`CASE WHEN accepted_at IS NOT NULL THEN 'accepted'
                                WHEN revoked_at IS NOT NULL THEN 'revoked'
                                WHEN expires_at <= now() THEN 'expired'
                                ELSE 'pending' END`.as('state'),
    ])
    .where('tenant_id', '=', tenantId)
    .orderBy('created_at', 'desc')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    state: r.state,
  }));
};

/**
 * A new invitation, after revoking a pending one for the same email and role (A2.4): its id. The database stamps who
 * made it and when, and checks the email's shape and the expiry's bounds.
 */
export const createInvitation = async (
  trx: Transaction<DB>,
  tenantId: string,
  invitation: { email: string; role: TenantRole; tokenHash: string },
): Promise<string> => {
  await trx
    .updateTable('app.invitations')
    .set({ revoked_at: sql`now()` })
    .where('tenant_id', '=', tenantId)
    .where('email', '=', invitation.email)
    .where('role', '=', invitation.role)
    .where('accepted_at', 'is', null)
    .where('revoked_at', 'is', null)
    .execute();
  // Plain SQL: the database stamps `created_by`, which the generated types count as a column to give.
  const { rows } = await sql<{ id: string }>`
    INSERT INTO app.invitations (tenant_id, email, role, token_hash, expires_at)
    VALUES (${tenantId}, ${invitation.email}, ${invitation.role}, ${invitation.tokenHash},
            now() + make_interval(days => ${INVITATION_DAYS}))
    RETURNING id`.execute(trx);
  const [row] = rows;
  if (!row) {
    throw new Error('The new invitation came back with no id');
  }
  return row.id;
};

/** Revokes a pending invitation; false if there is no pending one by that id. */
export const revokeInvitation = async (
  trx: Transaction<DB>,
  tenantId: string,
  id: string,
): Promise<boolean> => {
  const updated = await trx
    .updateTable('app.invitations')
    .set({ revoked_at: sql`now()` })
    .where('tenant_id', '=', tenantId)
    .where('id', '=', id)
    .where('accepted_at', 'is', null)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  return updated.numUpdatedRows > 0n;
};

/**
 * Deletes an accepted, revoked or expired invitation, so its email isn't kept (A2.6); false if RLS leaves none, as for
 * a pending one.
 */
export const deleteInvitation = async (
  trx: Transaction<DB>,
  tenantId: string,
  id: string,
): Promise<boolean> => {
  const deleted = await trx
    .deleteFrom('app.invitations')
    .where('tenant_id', '=', tenantId)
    .where('id', '=', id)
    .executeTakeFirst();
  return deleted.numDeletedRows > 0n;
};

/** Whether someone holds `role` in the tenant: inviting them again is refused (A2.5). */
export const holdsRole = async (
  trx: Transaction<DB>,
  tenantId: string,
  userId: string,
  role: TenantRole,
): Promise<boolean> =>
  (await trx
    .selectFrom('app.memberships')
    .select('user_id')
    .where('tenant_id', '=', tenantId)
    .where('user_id', '=', userId)
    .where('role', '=', role)
    .executeTakeFirst()) !== undefined;

/**
 * The email and role of a pending invitation, through the database's narrow lookup (R114), with no actor: whoever
 * holds the link. Undefined for any other token.
 */
export const pendingInvitation = async (
  db: Database,
  token: string,
): Promise<{ email: string; role: TenantRole } | undefined> => {
  const { rows } = await sql<{ email: string; role: TenantRole }>`
    SELECT email, role FROM private.pending_invitation(${hashInvitationToken(token)})`.execute(db);
  return rows[0];
};

/** Accepts it for the actor, whose verified email must be the invited one (R114); whether it did. */
export const acceptInvitation = async (trx: Transaction<DB>, token: string): Promise<boolean> => {
  const { rows } = await sql<{ done: boolean }>`
    SELECT private.accept_invitation(${hashInvitationToken(token)}) AS done`.execute(trx);
  return rows[0]?.done === true;
};

/** Sends an invitation's email (A2.2) through the platform's sender (PLAN R115); rejects if it can't. */
export type InvitationSender = (invitation: {
  email: string;
  role: TenantRole;
  /** The tenant's main language, which the email is written in. */
  locale: Locale;
  site: string;
  /** Who invites, by name; blank for an account without one, which the platform's name stands in for. */
  inviter: string;
  token: string;
}) => Promise<void>;

export const createInvitationSender =
  ({
    mailer,
    adminOrigin,
    platformName,
  }: {
    mailer: Mailer;
    adminOrigin: string;
    platformName: string;
  }): InvitationSender =>
  async ({ email, role, locale, site, inviter, token }) => {
    const t = getTranslator(locale);
    await mailer.send({
      to: email,
      fromName: platformName,
      subject: t('email.invitation.subject', { site, role: t(`email.roles.${role}`) }),
      text: t('email.invitation.body', {
        inviter: inviter.trim() === '' ? platformName : inviter,
        site,
        platform: platformName,
        role: t(`email.roles.${role}`),
        days: INVITATION_DAYS,
        link: invitationLink(adminOrigin, token),
      }),
    });
  };
