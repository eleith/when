FROM node:24-alpine AS base
WORKDIR /m

RUN corepack enable

FROM base AS dev

ENV COREPACK_HOME=/usr/local/corepack
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm build:packages
WORKDIR /m/apps/web
RUN mkdir -p data .svelte-kit node_modules/.cache node_modules/.vite node_modules/.vite-temp && \
    chmod 777 . && \
    chmod -R 777 data .svelte-kit node_modules/.cache node_modules/.vite node_modules/.vite-temp && \
    chmod -R 777 /m/packages/*/dist && \
    chmod -R a+rX "$COREPACK_HOME"
EXPOSE 5173
CMD ["sh", "-c", "pnpm -C /m build:packages && pnpm run dev --host 0.0.0.0"]

FROM base AS builder

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@when/web..." build

FROM builder AS pruner

RUN pnpm --filter @when/web --prod deploy --legacy /pruned

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
