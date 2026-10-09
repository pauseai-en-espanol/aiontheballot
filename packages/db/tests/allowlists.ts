/**
 * Which runtime role may execute which function in `app` and `private`, as "<role> <schema>.<function>(<args>)".
 * Adding an entry requires updating ADR-0002 (closed by default, §6).
 */
export const EXECUTE_ALLOWLIST: readonly string[] = [
  'aiontheballot_admin private.current_aal()',
  'aiontheballot_admin private.current_user_id()',
  'aiontheballot_admin private.is_platform_admin()',
  'aiontheballot_admin private.my_tenants(VARIADIC roles app.tenant_role[])',
];

/** SECURITY DEFINER functions allowed in `app` and `private` (ADR-0002 §6). */
export const SECURITY_DEFINER_ALLOWLIST: readonly string[] = [
  'private.audit',
  'private.bump_public_version',
  'private.is_platform_admin',
  'private.my_tenants',
];
