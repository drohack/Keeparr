/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // better-sqlite3 is a native module; keep it external on the server.
  serverExternalPackages: ['better-sqlite3'],
};

module.exports = nextConfig;
