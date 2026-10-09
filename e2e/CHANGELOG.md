# @aiontheballot/e2e

## 0.1.0

### Minor Changes

- c217473: Add Playwright smoke tests against production builds of web, admin and api: pages render, health probes answer, and
  the public site sets no cookies and keeps zoom enabled. Read the platform name at request time: the layouts were
  prerendered at build time, so every image would have shipped without a title.
