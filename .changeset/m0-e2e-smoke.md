---
'@ballot/e2e': minor
'@ballot/web': patch
'@ballot/admin': patch
---

Add Playwright smoke tests against production builds of web, admin and api: pages render, health probes answer, and
the public site sets no cookies and keeps zoom enabled. Read the platform name at request time: the layouts were
prerendered at build time, so every image would have shipped without a title.
