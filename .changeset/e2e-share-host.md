---
'@aiontheballot/e2e': patch
---

The share tests fetch by Host header on 127.0.0.1, so they pass on Linux runners, which can't resolve `*.localhost`.
