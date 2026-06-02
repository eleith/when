# syntax=docker/dockerfile:1
# Build context: the monorepo root.
#   docker build -f apps/worker/Dockerfile -t when-worker .
#
# Same shape as apps/web: install the workspace, build the @when/* packages then
# the worker (tsc -> dist/), `pnpm deploy` a pruned prod bundle (its own
# node_modules, no dev deps), and copy just that into a slim runner.

FROM --platform=linux/amd64 node:24-alpine AS base
WORKDIR /m
RUN corepack enable

# --- builder: install the workspace and compile the worker -------------------
# `@when/worker...` (trailing ...) builds the @when/* package deps in dependency
# order, then the worker.
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
