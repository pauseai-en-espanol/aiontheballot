/**
 * Which runtime role may execute which function in `app` and `private`, as "<role> <schema>.<function>(<args>)".
 * Adding an entry requires updating ADR-0002 (closed by default, §6).
 */
export const EXECUTE_ALLOWLIST: readonly string[] = [
  'aiontheballot_admin private.current_aal()',
  'aiontheballot_admin private.current_user_id()',
  'aiontheballot_admin private.is_platform_admin()',
  'aiontheballot_admin private.my_tenants(VARIADIC roles app.tenant_role[])',
  'aiontheballot_admin private.normalize_for_match(input text)',
  'aiontheballot_web app.submit_report(tenant uuid, kind app.report_kind, message text, election uuid, assessment uuid, name text, email text, organization text, is_party_representative boolean)',
  'aiontheballot_worker private.anonymize_expired_reports()',
  'aiontheballot_worker private.current_user_id()',
  'aiontheballot_worker private.normalize_for_match(input text)',
];

/** SECURITY DEFINER functions allowed in `app` and `private` (ADR-0002 §6). */
export const SECURITY_DEFINER_ALLOWLIST: readonly string[] = [
  'app.submit_report',
  'private.anonymize_expired_reports',
  'private.audit',
  'private.bump_public_version',
  'private.is_platform_admin',
  'private.my_tenants',
  'private.publish_revision',
];
