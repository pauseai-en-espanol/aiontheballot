# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
# Build context: the repository root. See package.json "docker:build".
ARG NODE_IMAGE=node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797
ARG PNPM_VERSION=12.14.0
ARG TURBO_VERSION=2.11.9

# ------ pnpm: shared by the stages below (npm/npx refuse the repo's pnpm-only devEngines) ------
FROM ${NODE_IMAGE} AS pnpm
ARG PNPM_VERSION
ENV CI=true HUSKY=0 TURBO_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@${PNPM_VERSION}

# ------ prune: only this app and the workspace packages it depends on ------
FROM pnpm AS prune
ARG TURBO_VERSION
WORKDIR /repo
COPY . .
RUN pnpm dlx turbo@${TURBO_VERSION} prune @aiontheballot/web --docker

# ------ build: install from manifests first (cached until they change), then build ------
FROM pnpm AS build
WORKDIR /repo
COPY --from=prune /repo/out/json/ ./
# Sources aren't here yet, so skip prepare hooks (e.g. panda codegen); the build runs them.
RUN PACKAGED=true pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ ./
RUN pnpm exec turbo run build --filter=@aiontheballot/web

# ------ runtime: Next.js standalone output only ------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
