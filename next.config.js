/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // better-sqlite3 is a native module; keep it external on the server.
  serverExternalPackages: ['better-sqlite3'],
  // Baseline security response headers. We intentionally do NOT set a strict
  // script-src/style-src CSP: the app uses an inline theme-init script
  // (app/layout.tsx) and Scalar (/api-docs) injects inline styles, so a full
  // CSP would need nonce plumbing and risk breakage for little gain on a
  // self-hosted app. `frame-ancestors` still gives clickjacking protection.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
