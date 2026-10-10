---
---

Make every release an Argo CD sync: the umbrella chart carries a ConfigMap of the release's image tags, so a release
that changes only the migration image still runs the migration Job (a Sync hook, which Argo never compares).
