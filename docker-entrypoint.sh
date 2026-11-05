#!/bin/sh
# Keeparr container entrypoint.
#
# Runs as ROOT so it can fix ownership of the /data bind mount (a fresh Unraid
# appdata path is created root:root, which would EACCES on first write), then
# drops to PUID:PGID via su-exec before exec'ing node. Nothing runs as root
# except this bootstrap.
#
# SESSION_SECRET handling (the Sonarr/Seerr pattern - no required secrets at
# install): if the env var is set it wins, unchanged. Otherwise a secret is
# generated ONCE and persisted at $DATA_DIR/.session-secret, living beside the
# database it protects (it signs sessions and encrypts stored service tokens),
# so appdata backups/moves carry it automatically.
#
# This runs BEFORE node starts so every runtime - including the Edge-sandboxed
# middleware, which cannot read files - sees the same process.env value.
set -e

DATA_DIR="${DATA_DIR:-/data}"
PUID="${PUID:-1001}"
PGID="${PGID:-1001}"

if [ -z "$SESSION_SECRET" ]; then
  SECRET_FILE="$DATA_DIR/.session-secret"
  if [ ! -s "$SECRET_FILE" ]; then
    umask 077
    node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" > "$SECRET_FILE"
    echo "Keeparr: generated a new session secret at $SECRET_FILE (keep this file - it encrypts your stored service tokens)"
  fi
  SESSION_SECRET="$(cat "$SECRET_FILE")"
  export SESSION_SECRET
fi

# Fix ownership of the whole data dir - AFTER secret generation so the freshly
# created .session-secret (root:root 0600) is re-owned to the runtime user and
# stays readable once we drop privileges below.
chown -R "$PUID:$PGID" "$DATA_DIR" 2>/dev/null || true

# Drop root -> PUID:PGID and hand off to node.
exec su-exec "$PUID:$PGID" "$@"
