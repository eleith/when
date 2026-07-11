FROM node:26-alpine AS base
WORKDIR /m

# pnpm keeps its store, cache and config under $HOME. In dev the container runs
# as the host uid (compose `user:`), not root, so $HOME=/root would be
# unwritable and pnpm fails with EACCES. Point everything at one world-writable
# dir baked into the image so the same image works for any uid.
ENV HOME=/home/app \
    PNPM_HOME=/home/app/.pnpm \
    XDG_DATA_HOME=/home/app/.local/share \
    XDG_CACHE_HOME=/home/app/.cache \
    XDG_CONFIG_HOME=/home/app/.config
RUN npm install -g pnpm@11.9.0 && mkdir -p /home/app && chmod -R 777 /home/app

FROM base AS dev

ENV CI=true
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch
COPY . .
RUN pnpm install --frozen-lockfile --offline
# Boot (re)builds into these dirs as the host uid: shared packages -> dist,
# svelte-kit -> .svelte-kit, vite -> node_modules/.vite. Only those parents need
# to be writable — recursing node_modules is slow and pointless. Drop the
# root-owned .svelte-kit left by the install-time `prepare` (svelte-kit sync) so
# `vite dev` regenerates it as the host uid.
RUN mkdir -p /m/apps/web/data \
    && rm -rf /m/apps/web/.svelte-kit \
    && chmod 777 /m/apps/web /m/apps/web/node_modules /m/packages/*/
WORKDIR /m/apps/web
EXPOSE 5173
CMD ["sh", "-c", "pnpm -C /m build:packages && pnpm run dev --host 0.0.0.0"]

FROM base AS builder

COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch
COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN pnpm --filter "@when/web..." build

FROM builder AS pruner

RUN pnpm --filter @when/web --prod deploy --legacy /pruned

FROM node:26-alpine AS prod
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
