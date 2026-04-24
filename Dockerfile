# syntax=docker/dockerfile:1.7

FROM --platform=linux/amd64 oven/bun:1.3.13-alpine AS builder
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build


FROM --platform=linux/amd64 oven/bun:1.3.13-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY --from=builder /app/build ./build

EXPOSE 3000
CMD ["bun", "build/index.js"]
