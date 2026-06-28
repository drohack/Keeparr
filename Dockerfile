# syntax=docker/dockerfile:1

# ---- Build stage ---------------------------------------------------------
# Alpine so the native module (better-sqlite3) is compiled against the same
# musl libc the runner uses.
FROM node:22-alpine AS builder
WORKDIR /app

# Build tools for better-sqlite3's native addon.
RUN apk add --no-cache python3 make g++ libc6-compat

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# Deploy gate: the full test suite must pass before an image is produced.
RUN npm test

# Next.js standalone output (see next.config.js: output: 'standalone').
RUN npm run build

# ---- Runtime stage -------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# SQLite db lives here; mount a volume at /data.
ENV DATA_DIR=/data

RUN apk add --no-cache libc6-compat \
  && addgroup -g 1001 -S nodejs \
  && adduser -u 1001 -S nextjs -G nodejs \
  && mkdir -p /data \
  && chown -R nextjs:nodejs /data

# Standalone server bundle + static assets (traced native modules included).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
VOLUME ["/data"]

# Health check (works in the Unraid Docker UI too, not just compose).
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
