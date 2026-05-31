# syntax=docker/dockerfile:1.7

FROM --platform=linux/amd64 node:24-alpine AS builder
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# --ignore-scripts: the `prepare` (svelte-kit sync) script can't run before the
# source is copied; the build below runs sync + type generation itself.
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN pnpm build


FROM --platform=linux/amd64 node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

COPY --from=builder /app/build ./build

USER node
EXPOSE 3000
CMD ["node", "build/index.js"]
