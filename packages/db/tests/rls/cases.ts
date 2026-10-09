import type { Case, Principal } from './harness.js';

import {
  MEMBERSHIPS,
  PLATFORM_ADMINS,
  PRINCIPALS,
  RELATIONS,
  type Rule,
  type TenantKey,
} from './matrix.js';

export interface MatrixCase extends Case {
  relation: string;
  /** "<operation> <row>", e.g. "update:active tenant B". */
  name: string;
  expected: 'allow' | 'deny';
}

/** What a rule says for one principal on a row of `tenant` (ADR-0002: the admin sees only what is the user's). */
export const expectedOutcome = (
  principal: Principal,
  rule: Rule,
  tenant: TenantKey | null,
  isPublic: boolean,
  write: boolean,
): 'allow' | 'deny' => {
  if (principal.role === 'aiontheballot_web') {
    return !write && rule.public === true && isPublic ? 'allow' : 'deny';
  }
  const { userId } = principal;
  if (principal.role !== 'aiontheballot_admin' || principal.aal !== 2 || !userId) {
    return 'deny';
  }
  if (rule.platformAdmin && PLATFORM_ADMINS.includes(userId)) {
    return 'allow';
  }
  const holds = (role: string): boolean =>
    MEMBERSHIPS.some((m) => m.user === userId && m.tenant === tenant && m.role === role);
  return tenant !== null && (rule.members ?? []).some(holds) ? 'allow' : 'deny';
};

/** Every principal × row × operation of every relation in the matrix. */
export const matrixCases = (): MatrixCase[] =>
  Object.entries(RELATIONS).flatMap(([relation, spec]) =>
    PRINCIPALS.flatMap((principal) => {
      const cases: MatrixCase[] = [];
      for (const row of spec.rows) {
        const target = `SELECT * FROM ${relation} WHERE ${row.where}`;
        const add = (op: string, sql: string, rule: Rule, write: boolean): void => {
          cases.push({
            relation,
            name: `${op} ${row.id}`,
            principal,
            sql,
            target,
            expected: expectedOutcome(principal, rule, row.tenant, row.public, write),
          });
        };
        add('select', `SELECT 1 FROM ${relation} WHERE ${row.where}`, spec.select, false);
        for (const [column, rule] of Object.entries(spec.columnReads ?? {})) {
          add(
            `select:${column}`,
            `SELECT ${column} FROM ${relation} WHERE ${row.where}`,
            rule,
            false,
          );
        }
        add('update', `UPDATE ${relation} SET ${spec.set} WHERE ${row.where}`, spec.update, true);
        for (const [column, { set, rule }] of Object.entries(spec.columnUpdates ?? {})) {
          add(`update:${column}`, `UPDATE ${relation} SET ${set} WHERE ${row.where}`, rule, true);
        }
        add('delete', `DELETE FROM ${relation} WHERE ${row.where}`, spec.delete, true);
      }
      for (const insert of spec.inserts) {
        cases.push({
          relation,
          name: `insert ${insert.id}`,
          principal,
          sql: insert.sql,
          target: `SELECT count(*) FROM ${relation}`,
          expected: expectedOutcome(principal, spec.insert, insert.tenant, false, true),
        });
      }
      return cases;
    }),
  );
