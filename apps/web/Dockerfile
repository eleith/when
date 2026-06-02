# syntax=docker/dockerfile:1
# One image, two targets (build context = monorepo root):
#   docker build -f apps/web/Dockerfile --target dev  -t when-web-dev .
#   docker build -f apps/web/Dockerfile               -t when-web     .   (prod, default)
#
# prod: install the workspace, build the @when/* packages then web, `pnpm deploy`
# a pruned prod bundle, copy just that into a slim runner.

FROM --platform=linux/amd64 node:24-alpine AS base
WORKDIR /m
RUN corepack enable

# --- dev: full workspace install + built @when/* packages; vite dev with live
#     reload. Source, config, and data are bind-mounted by docker-compose.dev.yml. -
FROM base AS dev
# COREPACK_HOME is a shared, world-readable path so cached pnpm works at runtime
# under whatever host UID/GID docker-compose.dev.yml runs the container as.
ENV COREPACK_HOME=/usr/local/corepack
COPY . .
# --ignore-scripts: `prepare` (svelte-kit sync) runs at dev startup. build:packages
# emits @when/* dist so `vite dev` can resolve them (the dev compose mounts only
# apps/web sources, so this dist survives at /m/packages/*/dist).
RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm build:packages
WORKDIR /m/apps/web
# Runtime-writable dirs for the host-mapped UID. vite 8 bundles its config to
# node_modules/.vite-temp/, caches to node_modules/.vite/, svelte-kit syncs to
# .svelte-kit/ — pre-create each so it exists and is writable.
RUN mkdir -p data .svelte-kit node_modules/.cache node_modules/.vite node_modules/.vite-temp && \
    chmod 777 . && \
    chmod -R 777 data .svelte-kit node_modules/.cache node_modules/.vite node_modules/.vite-temp && \
    chmod -R a+rX "$COREPACK_HOME"
EXPOSE 5173
CMD ["pnpm", "run", "dev", "--host", "0.0.0.0"]

# --- builder: install the workspace and build the @when/* packages + web -------
FROM base AS builder
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@when/web..." build

# --- pruner: self-contained prod deployment (no dev deps) --------------------
FROM builder AS pruner
RUN pnpm --filter @when/web --prod deploy --legacy /pruned

# --- prod (default) ----------------------------------------------------------
FROM base AS prod
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
COPY --from=pruner /pruned/build /app/build
COPY --from=pruner /pruned/node_modules /app/node_modules
COPY --from=pruner /pruned/package.json /app/package.json
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "/app/build/index.js"]
