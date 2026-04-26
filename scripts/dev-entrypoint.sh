#!/bin/sh
# Dev container entrypoint. Reinstalls deps only when bun.lock has
# changed since the last install (tracked by a hash marker stored
# inside the persistent /app/node_modules volume). Sidesteps the
# anonymous-volume "stale node_modules" problem without paying a full
# install on every start.
set -e

HASH_FILE=/app/node_modules/.installed-lockfile-sha
NEW_HASH=$(sha256sum bun.lock | awk '{print $1}')

if [ ! -f "$HASH_FILE" ] || [ "$(cat "$HASH_FILE")" != "$NEW_HASH" ]; then
	echo "[dev] lockfile changed (or first run) — installing dependencies"
	rm -rf /app/node_modules
	mkdir -p /app/node_modules
	bun install --frozen-lockfile
	echo "$NEW_HASH" >"$HASH_FILE"
else
	echo "[dev] lockfile unchanged — skipping install"
fi

exec bun run dev --host 0.0.0.0
