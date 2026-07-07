# syntax=docker/dockerfile:1

# ---- Build stage ---------------------------------------------------------
# Alpine so the native module (better-sqlite3) is compiled against the same
# musl libc the runner uses.
FROM node:22-alpine AS builder
WORKDIR /app

# Build tools for better-sqlite3's native addon.
RUN apk add --no-cache python3 make g++ libc6-compat

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# Tests run in CI (once, natively) before any image is built/pushed — see
# .github/workflows. Building here only compiles.
# Next.js standalone output (see next.config.js: output: 'standalone').
RUN npm run build

# ---- Runtime stage -------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

# Image metadata + Unraid Docker UI hints (icon + WebUI button).
LABEL org.opencontainers.image.title="Keeparr" \
      org.opencontainers.image.description="Plex-login web app to decide what media to keep and report what's reclaimable. Tags and reports only — never deletes." \
      org.opencontainers.image.source="https://github.com/drohack/Keeparr" \
      org.opencontainers.image.licenses="MIT" \
      net.unraid.docker.icon="https://raw.githubusercontent.com/drohack/Keeparr/main/public/icon.png" \
      net.unraid.docker.webui="http://[IP]:[PORT:3000]/"

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# SQLite db lives here; mount a volume at /data.
ENV DATA_DIR=/data

RUN apk add --no-cache libc6-compat \
  && addgroup -g 1001 -S nodejs \
  && adduser -u 1001 -S nextjs -G nodejs \
  && mkdir -p /data \
  && chown -R nextjs:nodejs /data \
  # Runtime is `node server.js` — the bundled package managers are never
  # invoked. Drop npm/npx/yarn/corepack: their transitive deps carry CVEs and
  # they're pure attack surface here.
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
           /usr/local/lib/node_modules/corepack /usr/local/bin/corepack \
           /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg

# Standalone server bundle + static assets (traced native modules included).
# public/ must be copied explicitly — Next's standalone output does NOT
# include it (PWA icons + any static asset 404 without this).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Entrypoint auto-generates SESSION_SECRET into /data on first boot when the
# env var isn't provided (no required secrets at install — the Seerr pattern).
COPY --chmod=755 docker-entrypoint.sh /docker-entrypoint.sh

USER nextjs
EXPOSE 3000
VOLUME ["/data"]

# Health check (works in the Unraid Docker UI too, not just compose).
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "server.js"]
