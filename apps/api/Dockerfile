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

# ------ prune: only the API and the workspace packages it depends on ------
FROM pnpm AS prune
ARG TURBO_VERSION
WORKDIR /repo
COPY . .
RUN pnpm dlx turbo@${TURBO_VERSION} prune @aiontheballot/api --docker

# ------ build, then deploy: production dependencies only, workspace packages injected ------
FROM pnpm AS build
WORKDIR /repo
COPY --from=prune /repo/out/json/ ./
# Sources aren't here yet, so skip prepare hooks (e.g. panda codegen); the build runs them.
RUN PACKAGED=true pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ ./
RUN pnpm exec turbo run build --filter=@aiontheballot/api \
 && pnpm --filter=@aiontheballot/api deploy --prod /prod/api

# ------ runtime ------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /prod/api/package.json ./
COPY --from=build --chown=node:node /prod/api/node_modules ./node_modules
COPY --from=build --chown=node:node /prod/api/dist ./dist
USER node
EXPOSE 3001
CMD ["node", "dist/server.js"]
