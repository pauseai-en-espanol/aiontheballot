---
'@aiontheballot/api': patch
---

The two test suites that start child processes (the file sweep and the child extractor) get 30 seconds a test, so a
busy CI runner doesn't fail them; nothing the API does changes.
