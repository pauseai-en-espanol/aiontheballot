---
---

Check, before a push and in CI, that every deployable whose code changed is in the release plan, so a migration can't
ship without its image (`scripts/check-deployables-released.sh`).
