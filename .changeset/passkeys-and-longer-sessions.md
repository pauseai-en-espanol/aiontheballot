---
'@aiontheballot/api': minor
'@aiontheballot/admin': minor
'@aiontheballot/i18n': minor
'@aiontheballot/migrations': minor
'@aiontheballot/e2e': patch
---

Signing in less often (PLAN D22). A session now ends 48 hours after it was last used, and a week after sign-in at the
latest, instead of 12 hours after sign-in whatever happened. And passkeys, optional: the Passkeys page, beside Tokens,
adds one on this computer or phone (or in a password manager), and the sign-in page's "Use a passkey" then signs in with
it alone, the device checking the fingerprint, face or PIN. The password and the code keep working. Removing a passkey
signs its member out everywhere and revokes their tokens for tools; the owner's reset of a lost authenticator removes
the passkeys too.
