# syntax=docker/dockerfile:1
# Build context: the monorepo root.
#   docker build -f apps/web/Dockerfile -t when-web .
#
# Same shape as the worker: install the workspace, build the app, then
# `pnpm deploy` a pruned prod bundle (its own node_modules, no dev deps) and copy
# just that into the runtime image. COPY . . (not a selective manifest copy) so
# the @when/* workspace members are present for the frozen-lockfile install.

FROM --platform=linux/amd64 node:24-alpine AS base
WORKDIR /m
RUN corepack enable

# --- builder: install the workspace and build the SvelteKit app --------------
# `@when/web...` (note the trailing `...`) builds the @when/* workspace packages
# first, in dependency order, then web — required now that they are build
# packages whose `dist/` the SvelteKit build imports.
FROM base AS builder
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@when/web..." build

# --- pruner: self-contained prod deployment (no dev deps) --------------------
FROM builder AS pruner
RUN pnpm --filter @when/web --prod deploy --legacy /pruned

# --- runner (default) --------------------------------------------------------
FROM base AS runner
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
