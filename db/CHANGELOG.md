# @aiontheballot/migrations

## 0.1.0

### Minor Changes

- 6ed9131: Ship Docker images: web, admin and api built with turbo prune (manifest-only install layer), running as non-root, and
  a migrations image (dbmate plus the migrations) for the chart's PreSync Job. The Next apps run panda codegen as part of
  their build, so builds no longer depend on install-time hooks.

### Patch Changes

- 8a9f648: Add the Helm charts: a subchart per deployable and the `aiontheballot` umbrella chart (migrations as an Argo CD PreSync Job,
  routes for the public and admin hosts, restrictive security contexts and resource limits).
- 6c95c16: Run the migration Job as an Argo CD Sync hook in wave -1 instead of PreSync, so on a first sync it runs after the gitops
  Secrets and the Harbor pull secret exist, and still before the new pods roll out.
