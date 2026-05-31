# syntax=docker/dockerfile:1.7

FROM --platform=linux/amd64 node:24-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@11.5.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
# Regenerate the config types from the schema, then build (deterministic — does
# not rely on a host-generated schema.d.ts being copied in).
RUN pnpm generate:types && pnpm build


FROM --platform=linux/amd64 node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
RUN npm install -g pnpm@11.5.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

COPY --from=builder /app/build ./build

USER node
EXPOSE 3000
CMD ["node", "build/index.js"]
