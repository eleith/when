# syntax=docker/dockerfile:1
# Build context: the monorepo root.
#   docker build -f apps/worker/Dockerfile -t when-worker .
#
# Modeled on luzzle's worker Dockerfile: install the whole workspace, build the
# worker, then `pnpm deploy` a pruned prod bundle (its own node_modules with no
# dev deps) and copy just that into the runtime image.

FROM node:24-alpine AS base
WORKDIR /m
RUN corepack enable

# --- builder: install the workspace and bundle the worker --------------------
FROM base AS builder
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @when/worker build

# --- pruner: self-contained prod deployment (no dev deps) --------------------
FROM builder AS pruner
RUN pnpm --filter @when/worker --prod deploy --legacy /pruned

# --- prod (default) ----------------------------------------------------------
FROM base AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY --from=pruner /pruned/build /app/build
COPY --from=pruner /pruned/node_modules /app/node_modules
COPY --from=pruner /pruned/package.json /app/package.json
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 9000
CMD ["node", "/app/build/index.js"]
