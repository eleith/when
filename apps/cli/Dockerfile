# syntax=docker/dockerfile:1
FROM node:26-alpine AS base
WORKDIR /m

# Keep pnpm installs/builds non-interactive in every build stage (dev + builder).
ENV CI=true

# pnpm keeps its store, cache and config under $HOME. In dev the container runs
# as the host uid (compose `user:`), not root, so $HOME=/root would be
# unwritable and pnpm fails with EACCES. Point everything at one world-writable
# dir baked into the image so the same image works for any uid. store-dir is
# pinned so the BuildKit cache mount on fetch/install lands on a stable path
# (pnpm's same-drive heuristic would otherwise move it off the mount).
ENV HOME=/home/app \
    PNPM_HOME=/home/app/.pnpm \
    XDG_DATA_HOME=/home/app/.local/share \
    XDG_CACHE_HOME=/home/app/.cache \
    XDG_CONFIG_HOME=/home/app/.config
RUN npm install -g pnpm@11.9.0 \
    && mkdir -p /home/app/store \
    && printf 'store-dir=/home/app/store\n' > /home/app/.npmrc \
    && chmod -R 777 /home/app

FROM base AS dev

COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/home/app/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/home/app/store pnpm install --frozen-lockfile
# Boot rebuilds the shared packages -> dist as the host uid; the cli itself runs
# straight from source (node src/index.ts). Only the package dirs need writing.
RUN mkdir -p /m/apps/cli/data && chmod 777 /m/packages/*/

ENTRYPOINT ["sh", "-c", "pnpm -C /m build:packages && node /m/apps/cli/src/index.ts \"$@\"", "--"]

FROM base AS builder

COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/home/app/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/home/app/store pnpm install --frozen-lockfile
RUN pnpm --filter "@when/cli..." build

FROM builder AS pruner

RUN pnpm --filter @when/cli --prod deploy --legacy /pruned

FROM node:26-alpine AS prod
WORKDIR /app

ENV NODE_ENV=production
COPY --from=pruner /pruned/dist /app/dist
COPY --from=pruner /pruned/node_modules /app/node_modules
COPY --from=pruner /pruned/package.json /app/package.json
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

ENTRYPOINT ["node", "/app/dist/index.js"]
