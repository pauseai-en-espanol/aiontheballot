---
'@ballot/ui': patch
---

Build the UI package on install, so the web and admin Panda codegen can load its preset on a clean checkout. CI's first
run failed at `pnpm install` because `dist/` did not exist yet.
