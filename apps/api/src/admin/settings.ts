import type { DB } from '@aiontheballot/db/generated/db';
import type { Localized } from '@aiontheballot/domain/localized';

import { isLocalized } from '@aiontheballot/domain/localized';
import { sql, type Transaction } from 'kysely';

import { lockTenant } from './access.js';

export interface SettingsChange {
  /** Days a report is kept before it is anonymized (T3). */
  reportRetentionDays?: number;
  /** Whether a live change needs a second person to approve it (P1). */
  liveEditsNeedSecondApprover?: boolean;
}

export type ChangeResult = 'changed' | 'not-found' | 'forbidden' | 'stale';

/**
 * Changes a tenant's settings (editorial workflow T3, P1). The database decides who may: RLS gives the tenant's row to
 * country admins and platform admins to change, and `members_may_change` lets only platform admins change whether live
 * edits need a second approver (P1.1); both changes are audited. For anyone else the update changes nothing.
 */
export const updateSettings = async (
  trx: Transaction<DB>,
  tenantId: string,
  change: SettingsChange,
): Promise<ChangeResult> => {
  const updated = await trx
    .updateTable('app.tenants')
    .set({
      ...(change.reportRetentionDays === undefined
        ? {}
        : { report_retention_days: change.reportRetentionDays }),
      ...(change.liveEditsNeedSecondApprover === undefined
        ? {}
        : { live_edits_need_second_approver: change.liveEditsNeedSecondApprover }),
    })
    .where('id', '=', tenantId)
    .returning('id')
    .executeTakeFirst();
  return updated ? 'changed' : 'forbidden';
};

/** The operator's texts (editorial workflow T2), as `app.tenant_document_kind` has them. */
export const DOCUMENT_KINDS = [
  'privacy_policy',
  'right_of_reply_policy',
  'about_operator',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export interface DocumentVersion {
  id: string;
  kind: DocumentKind;
  version: number;
  body: Localized;
  /** Null while a draft. */
  publishedAt: string | null;
  createdAt: string;
}

/** Every version of the tenant's texts, newest first in each kind: every member reads them. */
export const listDocuments = async (
  trx: Transaction<DB>,
  tenantId: string,
): Promise<DocumentVersion[]> => {
  const rows = await trx
    .selectFrom('app.tenant_documents')
    .select(['id', 'kind', 'version', 'body', 'published_at', 'created_at'])
    .where('tenant_id', '=', tenantId)
    .orderBy('kind')
    .orderBy('version', 'desc')
    .execute();
  return rows.map((row) => {
    if (!isLocalized(row.body)) {
      throw new Error('tenant_documents.body is not localized text');
    }
    return {
      id: row.id,
      kind: row.kind,
      version: row.version,
      body: row.body,
      publishedAt: row.published_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
    };
  });
};

export type CreateResult = { id: string } | 'draft-exists' | 'forbidden';

/**
 * Starts a version of a text, as a draft or published at once (T2.2): only country admins and platform admins may
 * (RLS, and the lock they alone can take), the version number and author come from the trigger, and publishing needs
 * the default locale. One draft per kind at a time is the API's rule, so a draft can't be forgotten beside another;
 * the lock makes two started at the same moment run one after the other, so the second finds the first.
 */
export const createDocument = async (
  trx: Transaction<DB>,
  tenantId: string,
  kind: DocumentKind,
  body: Localized,
  publish: boolean,
): Promise<CreateResult> => {
  // Two starts at once run one after the other, so the second sees the first's draft (R99).
  if (!(await lockTenant(trx, tenantId))) {
    return 'forbidden';
  }
  const draft = await trx
    .selectFrom('app.tenant_documents')
    .select('id')
    .where('tenant_id', '=', tenantId)
    .where('kind', '=', kind)
    .where('published_at', 'is', null)
    .executeTakeFirst();
  if (draft) {
    return 'draft-exists';
  }
  // Raw, since the generated type asks for version and created_by, which the triggers set.
  const { rows } = await sql<{ id: string }>`
    INSERT INTO app.tenant_documents (tenant_id, kind, body, published_at)
    VALUES (${tenantId}, ${kind}, ${JSON.stringify(body)}::jsonb, ${publish ? sql`now()` : null})
    RETURNING id`.execute(trx);
  const [row] = rows;
  return row ? { id: row.id } : 'forbidden';
};

/**
 * Saves a draft's text, and publishes it with that text if asked (T2.2), in one statement. RLS gives drafts only, and
 * only to country admins and platform admins; a published version never changes.
 */
export const updateDocument = async (
  trx: Transaction<DB>,
  tenantId: string,
  id: string,
  body: Localized,
  publish: boolean,
): Promise<ChangeResult> => {
  const updated = await trx
    .updateTable('app.tenant_documents')
    .set({ body: JSON.stringify(body), ...(publish ? { published_at: sql<Date>`now()` } : {}) })
    .where('tenant_id', '=', tenantId)
    .where('id', '=', id)
    .returning('id')
    .executeTakeFirst();
  return updated ? 'changed' : refusalFor(trx, tenantId, id);
};

/** Deletes a draft (T2.3); published versions stay as history. */
export const deleteDocument = async (
  trx: Transaction<DB>,
  tenantId: string,
  id: string,
): Promise<ChangeResult> => {
  const deleted = await trx
    .deleteFrom('app.tenant_documents')
    .where('tenant_id', '=', tenantId)
    .where('id', '=', id)
    .returning('id')
    .executeTakeFirst();
  return deleted ? 'changed' : refusalFor(trx, tenantId, id);
};

/** Why a write to a version changed nothing: it isn't there for the actor, it is published, or they may not. */
const refusalFor = async (
  trx: Transaction<DB>,
  tenantId: string,
  id: string,
): Promise<ChangeResult> => {
  const row = await trx
    .selectFrom('app.tenant_documents')
    .select('published_at')
    .where('tenant_id', '=', tenantId)
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) {
    return 'not-found';
  }
  return row.published_at === null ? 'forbidden' : 'stale';
};
