/**
 * What the admin API answers when the database refuses a write (editorial workflow §2.3). The database is the
 * boundary (ADR-0002): its SQLSTATE says what kind of refusal it was, and the answer names that kind, as a message key
 * the admin translates, never the database's own message or detail, which can quote the values written (an
 * invitation's email, say). The constraint's name is passed on, so the admin can point at the field.
 */
export interface DatabaseRefusal {
  status: 400 | 403 | 409 | 422 | 500;
  /** A key under `errors` in `packages/i18n`'s messages, where each has its English and Spanish text. */
  error: 'forbidden' | 'stale' | 'incomplete' | 'taken' | 'invalid' | 'unexpected';
  /** The constraint that refused it, for a unique or check violation. */
  constraint?: string;
  /** Whether it is a fault to report (GlitchTip, without the request's body), rather than a refusal to explain. */
  report: boolean;
}

const KINDS: Readonly<Record<string, Omit<DatabaseRefusal, 'constraint' | 'report'>>> = {
  // A missing role, aal1, four-eyes, RLS's WITH CHECK.
  '42501': { status: 403, error: 'forbidden' },
  // The wrong state, a stale version, the election's status, the freeze window: reload and try again.
  '23001': { status: 409, error: 'stale' },
  // What the content lacks: evidence, a default-locale text, a checked document.
  '23514': { status: 422, error: 'incomplete' },
  // A slug or an invitation already taken.
  '23505': { status: 409, error: 'taken' },
  // A value the database can't take as given: a bad id, a malformed date.
  '22023': { status: 400, error: 'invalid' },
  '22P02': { status: 400, error: 'invalid' },
  '22007': { status: 400, error: 'invalid' },
  '22008': { status: 400, error: 'invalid' },
};

/** The answer for an error thrown by a query: a known refusal, or an unexpected fault to report. */
export const databaseRefusal = (error: unknown): DatabaseRefusal => {
  // node-postgres puts the SQLSTATE in `code`; anything not listed, Node's own codes included, is unexpected.
  const code = (error as { code?: unknown } | null)?.code;
  const kind = typeof code === 'string' ? KINDS[code] : undefined;
  if (!kind) {
    return { status: 500, error: 'unexpected', report: true };
  }
  const constraint = (error as { constraint?: unknown }).constraint;
  return {
    ...kind,
    ...(typeof constraint === 'string' && (kind.error === 'taken' || kind.error === 'incomplete')
      ? { constraint }
      : {}),
    report: false,
  };
};
