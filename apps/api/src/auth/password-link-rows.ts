/**
 * Which verification rows are links to set a password: stored as their token's hash (43 base64url characters), never
 * as one of the two-factor plugin's plain, prefixed identifiers (`2fa-…`, `trust-device-…`). An SQL condition on the
 * row aliased `alias`, shared by the links' checks (auth.ts) and the reset of a lost authenticator, which forgets them.
 */
export const passwordLinkRow = (alias: string): string =>
  `${alias}.identifier ~ '^[A-Za-z0-9_-]{43}$' AND ${alias}.identifier NOT LIKE '2fa-%'
   AND ${alias}.identifier NOT LIKE 'trust-device-%'`;
