# syntax=docker/dockerfile:1
# One image, two targets (build context = monorepo root):
#   docker build -f apps/worker/Dockerfile --target dev  -t when-worker-dev .
#   docker build -f apps/worker/Dockerfile               -t when-worker     .   (prod, default)
#
# Same shape as apps/web. The worker compiles with tsc to dist/ and runs as
# `node dist/src/index.js`.

FROM --platform=linux/amd64 node:24-alpine AS base
WORKDIR /m
RUN corepack enable

# --- dev: full workspace install with @when/* prebuilt; live reload via
#     `tsc --watch` + `node --watch`. Source/config/data are bind-mounted. -------
FROM base AS dev
# COREPACK_HOME is a shared, world-readable path so cached pnpm works at runtime
# under whatever host UID/GID docker-compose.dev.yml runs the container as.
ENV COREPACK_HOME=/usr/local/corepack
COPY . .
# build:packages emits @when/* dist so the worker's tsc build + runtime resolve
# them; the worker's own dist is (re)built at container start from the mounted src.
RUN pnpm install --frozen-lockfile && pnpm build:packages && chmod -R a+rX "$COREPACK_HOME"
# Runtime-writable dirs for the host-mapped UID: tsc output (dist) + sqlite (data).
RUN mkdir -p /m/apps/worker/dist /m/apps/worker/data && \
    chmod -R 777 /m/apps/worker/dist /m/apps/worker/data
EXPOSE 9000
CMD ["pnpm", "--filter", "@when/worker", "dev"]

# --- builder: install the workspace and compile the worker -------------------
# `@when/worker...` (trailing ...) builds the @when/* package deps in order, then
# the worker.
FROM base AS builder
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@when/worker..." build

# --- pruner: self-contained prod deployment (no dev deps) --------------------
FROM builder AS pruner
RUN pnpm --filter @when/worker --prod deploy --legacy /pruned

# --- prod (default) ----------------------------------------------------------
FROM base AS prod
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=9000
COPY --from=pruner /pruned/dist /app/dist
COPY --from=pruner /pruned/node_modules /app/node_modules
COPY --from=pruner /pruned/package.json /app/package.json
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 9000
CMD ["node", "/app/dist/src/index.js"]
