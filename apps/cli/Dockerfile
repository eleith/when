FROM node:26-alpine AS base
WORKDIR /m

RUN npm install -g pnpm@11.9.0

FROM base AS dev

COPY . .
RUN pnpm install --frozen-lockfile && pnpm build:packages
RUN mkdir -p /m/apps/cli/dist /m/apps/cli/data && \
    chmod -R 777 /m/apps/cli/dist /m/apps/cli/data /m/packages/*/dist

ENTRYPOINT ["sh", "-c", "pnpm -C /m build:packages && node /m/apps/cli/src/index.ts \"$@\"", "--"]

FROM base AS builder

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@when/cli..." build

FROM builder AS pruner

RUN pnpm --filter @when/cli --prod deploy --legacy /pruned

FROM base AS prod
WORKDIR /app

ENV NODE_ENV=production
COPY --from=pruner /pruned/dist /app/dist
COPY --from=pruner /pruned/node_modules /app/node_modules
COPY --from=pruner /pruned/package.json /app/package.json
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

ENTRYPOINT ["node", "/app/dist/index.js"]
