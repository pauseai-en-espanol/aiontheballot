---
'@aiontheballot/e2e': patch
---

Reach the fictional sites' hostnames through the by-host helper in every request a test makes itself, since Node
doesn't resolve `*.localhost` on the self-hosted runner (browsers do).
