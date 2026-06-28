/**
 * Local demo data loader. Run with `npm run seed` (add `-- --reset` to wipe and
 * reload). Fills ./data/keeparr.db with fake libraries so you can click through
 * the app without Plex. See lib/dev-seed.ts.
 */
import fs from 'node:fs';

// Load .env (if present) BEFORE importing app modules, so this script derives the
// same encryption key as `next dev` (which loads .env). Without this, seeded
// secrets would be unreadable by the server and pages would fail.
if (fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
}

const { getDb, __closeDb } = await import('../lib/db');
const { seedDevData } = await import('../lib/dev-seed');
const { formatSize } = await import('../lib/format');

const reset = process.argv.includes('--reset');

if (reset) {
  const db = getDb();
  for (const t of ['seerr_requests', 'watch_history', 'user_skips', 'keeps', 'media_items']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  console.log('Cleared media + keep/skip/watch/seerr tables.');
}

const r = seedDevData({ reset });
console.log(
  `Seed complete — ${r.totalItems} items, ${formatSize(r.totalBytes)} total` +
    (r.seededMedia ? '' : ' (media already present; left as-is)') +
    '.'
);
console.log('Now run:  KEEPARR_DEV_LOGIN=1 npm run dev   then open http://localhost:3000');

__closeDb();
