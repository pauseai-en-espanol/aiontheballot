/**
 * Which runtime role may execute which function in `app` and `private`, as "<role> <schema>.<function>(<args>)".
 * Adding an entry requires updating ADR-0002 (closed by default, §6).
 */
export const EXECUTE_ALLOWLIST: readonly string[] = [
  'ballot_admin private.current_aal()',
  'ballot_admin private.current_user_id()',
];

/** SECURITY DEFINER functions allowed in `app` and `private` (ADR-0002 §6). None yet. */
export const SECURITY_DEFINER_ALLOWLIST: readonly string[] = [];
