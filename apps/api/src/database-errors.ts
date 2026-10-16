/**
 * What the admin API answers when the database refuses a write (editorial workflow §2.3). The database is the
 * boundary (ADR-0002): its SQLSTATE says what kind of refusal it was, and the answer names that kind, as a message key
 * the admin translates, never the database's own message or detail, which can quote the values written (an
 * invitation's email, say). The constraint's name is passed on, so the admin can point at the field.
 */
/** Every message key a refusal can carry. */
export const REFUSAL_KEYS = [
  'forbidden',
  'stale',
  'incomplete',
  'taken',
  'linked',
  'invalid',
  'limit',
  'unexpected',
] as const;

export interface DatabaseRefusal {
  status: 400 | 403 | 409 | 422 | 429 | 500;
  /** A key under `errors` in `packages/i18n`'s messages, where each has its English and Spanish text. */
  error: (typeof REFUSAL_KEYS)[number];
  /** The constraint that refused it, for a unique, foreign key or check violation. */
  constraint?: string;
  /** Whether it is a fault to report (GlitchTip, without the request's body), rather than a refusal to explain. */
  report: boolean;
}

interface Kind extends Pick<DatabaseRefusal, 'status' | 'error'> {
  /** Still a fault to report, though it has an answer for the user. */
  report?: true;
  /** Only when raised by this function (`routine`); from anywhere else, a fault. */
  only?: string;
}

const KINDS: Readonly<Record<string, Kind>> = {
  // A missing role, aal1, four-eyes, RLS's WITH CHECK. A missing grant is a fault instead (below).
  '42501': { status: 403, error: 'forbidden' },
  // The wrong state, a stale version, the election's status, the freeze window: reload and try again.
  '23001': { status: 409, error: 'stale' },
  // Another transaction got there first (a serialization failure, a deadlock): the same answer. A deadlock also
  // means two writes take their locks in different orders, a bug to fix.
  '40001': { status: 409, error: 'stale' },
  '40P01': { status: 409, error: 'stale', report: true },
  // What the content lacks: evidence, a default-locale text, a checked document.
  '23514': { status: 422, error: 'incomplete' },
  // A slug or an invitation already taken.
  '23505': { status: 409, error: 'taken' },
  // Something it names is gone, or something still names what it removes.
  '23503': { status: 409, error: 'linked' },
  // A limit a trigger keeps, such as the reports a site takes in a day. Postgres's own limits (an index entry too
  // large, say) raise it too, from elsewhere: those are faults.
  '54000': { status: 429, error: 'limit', only: 'exec_stmt_raise' },
  // A value the database can't take as given: a bad id, a malformed date.
  '22023': { status: 400, error: 'invalid' },
  '22P02': { status: 400, error: 'invalid' },
  '22007': { status: 400, error: 'invalid' },
  '22008': { status: 400, error: 'invalid' },
  // Text Postgres can't hold: a NUL character, in a text column or in localized jsonb.
  '22021': { status: 400, error: 'invalid' },
  '22P05': { status: 400, error: 'invalid' },
};

/**
 * Where Postgres refuses a privilege the role lacks (`permission denied for table …`, a column, a type, a sequence),
 * or a query RLS would filter while row security is off: the API asked for something its grants or settings never
 * allow, a bug to report, not a user's refusal to explain. RLS (`ExecWithCheckOptions`) and the triggers
 * (`exec_stmt_raise`) raise the same SQLSTATE from elsewhere.
 */
const GRANT_CHECKS = new Set([
  'aclcheck_error',
  'aclcheck_error_col',
  'nextval_internal',
  'currval_oid',
  'lastval',
  'do_setval',
  'check_enable_rls',
]);

/** The kinds whose constraint names the field at fault. */
const NAMED: ReadonlySet<DatabaseRefusal['error']> = new Set(['taken', 'incomplete', 'linked']);

/** The answer for an error thrown by a query: a known refusal, or an unexpected fault to report. */
export const databaseRefusal = (error: unknown): DatabaseRefusal => {
  // node-postgres puts the SQLSTATE in `code`, and the C function that raised it in `routine`; anything not listed,
  // Node's own codes included, is unexpected.
  const { code, routine, constraint } = (error ?? {}) as {
    code?: unknown;
    routine?: unknown;
    constraint?: unknown;
  };
  const kind = typeof code === 'string' ? KINDS[code] : undefined;
  if (
    !kind ||
    (kind.only !== undefined && routine !== kind.only) ||
    (typeof routine === 'string' && GRANT_CHECKS.has(routine))
  ) {
    return { status: 500, error: 'unexpected', report: true };
  }
  return {
    status: kind.status,
    error: kind.error,
    ...(typeof constraint === 'string' && NAMED.has(kind.error) ? { constraint } : {}),
    report: kind.report ?? false,
  };
};
