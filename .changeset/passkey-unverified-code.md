---
'@aiontheballot/api': patch
---

A passkey whose device didn't check who holds it (fingerprint, face or PIN) is refused with its own reason again, which
the admin explains, when adding one and when signing in. Since Better Auth 1.7.18 its passkey plugin refused it first,
as a ceremony that failed for no reason the admin could tell.
