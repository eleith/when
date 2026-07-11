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
ENV WHEN_URL_INTERNAL=http://when-app:5173
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch
COPY . .
RUN pnpm install --frozen-lockfile --offline
# Boot (re)builds into these dirs as the host uid: shared packages + worker ->
# dist. Only those parents need to be writable — recursing node_modules is slow
# and pointless.
RUN mkdir -p /m/apps/worker/data \
    && chmod 777 /m/apps/worker /m/apps/worker/node_modules /m/packages/*/
EXPOSE 9000
CMD ["sh", "-c", "pnpm build:packages && pnpm --filter @when/worker dev"]

FROM base AS builder

COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch
COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN pnpm --filter "@when/worker..." build

FROM builder AS pruner

RUN pnpm --filter @when/worker --prod deploy --legacy /pruned

FROM node:26-alpine AS prod
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=9000
ENV WHEN_URL_INTERNAL=http://when-app:3000
COPY --from=pruner /pruned/dist /app/dist
COPY --from=pruner /pruned/node_modules /app/node_modules
COPY --from=pruner /pruned/package.json /app/package.json
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 9000
CMD ["node", "/app/dist/src/index.js"]
