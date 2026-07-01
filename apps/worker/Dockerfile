FROM node:26-alpine AS base
WORKDIR /m

RUN npm install -g pnpm@11.9.0

FROM base AS dev

ENV WHEN_URL_INTERNAL=http://when-app:5173
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build:packages
RUN mkdir -p /m/apps/worker/dist /m/apps/worker/data && \
    chmod -R 777 /m/apps/worker/dist /m/apps/worker/data /m/packages/*/dist
EXPOSE 9000
CMD ["sh", "-c", "pnpm -C /m build:packages && pnpm --filter @when/worker dev"]

FROM base AS builder

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@when/worker..." build

FROM builder AS pruner

RUN pnpm --filter @when/worker --prod deploy --legacy /pruned

FROM base AS prod
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
