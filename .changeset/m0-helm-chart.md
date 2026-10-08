---
'@ballot/web': patch
'@ballot/admin': patch
'@ballot/api': patch
'@ballot/migrations': patch
---

Add the Helm charts: a subchart per deployable and the `ballot` umbrella chart (migrations as an Argo CD PreSync Job,
routes for the public and admin hosts, restrictive security contexts and resource limits).
