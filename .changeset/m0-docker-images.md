---
'@ballot/web': minor
'@ballot/admin': minor
'@ballot/api': minor
'@ballot/migrations': minor
---

Ship Docker images: web, admin and api built with turbo prune (manifest-only install layer), running as non-root, and
a migrations image (dbmate plus the migrations) for the chart's PreSync Job. The Next apps run panda codegen as part of
their build, so builds no longer depend on install-time hooks.
