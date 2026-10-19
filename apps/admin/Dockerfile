# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
# Build context: the repository root. See package.json "docker:build".
ARG NODE_IMAGE=node:26.12.0-alpine@sha256:6f08a523443ddedf52941874c203475b0ad503e859ad70cb26ab8be9a517dbd5
ARG PNPM_VERSION=12.10.1
ARG TURBO_VERSION=2.11.7

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
RUN pnpm dlx turbo@${TURBO_VERSION} prune @aiontheballot/admin --docker

# ------ build: install from manifests first (cached until they change), then build ------
FROM pnpm AS build
WORKDIR /repo
COPY --from=prune /repo/out/json/ ./
# Sources aren't here yet, so skip prepare hooks (e.g. panda codegen); the build runs them.
RUN PACKAGED=true pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ ./
RUN pnpm exec turbo run build --filter=@aiontheballot/admin

# ------ runtime: Next.js standalone output only ------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production PORT=3002 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/admin/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/admin/.next/static ./apps/admin/.next/static
USER node
EXPOSE 3002
CMD ["node", "apps/admin/server.js"]
