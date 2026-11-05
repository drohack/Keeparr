/**
 * Run the dev server against your REAL media server, in an isolated data dir.
 *
 *   npm run dev:real
 *
 * Why this exists: `npm run seed` + `KEEPARR_DEV_LOGIN=1` gives you a fake,
 * self-contained demo - great for UI work, useless for verifying anything that
 * actually talks to Plex. This exercises the first-run setup, the Plex PIN
 * login and Discover & connect locally, without deploying.
 *
 * It deliberately does NOT set KEEPARR_DEV_LOGIN and does NOT seed, so you get
 * the genuine first-run experience: setup -> Plex login -> Discover & connect ->
 * run jobs against your real libraries.
 *
 * DATA_DIR defaults to ./data-real so your demo data in ./data is untouched and
 * the two can coexist. Override with DATA_DIR=... if you want several.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const dataDir = resolve(process.env.DATA_DIR?.trim() || './data-real');
mkdirSync(dataDir, { recursive: true });

const port = process.env.PORT?.trim() || '3111';

console.log(`Keeparr dev (REAL backend)`);
console.log(`  DATA_DIR : ${dataDir}`);
console.log(`  port     : ${port}`);
console.log(`  login    : real (KEEPARR_DEV_LOGIN is deliberately NOT set)`);
console.log(`  seed     : none - this is a first-run install`);
console.log('');
console.log('Open the app and you should land on the first-run setup screen.');
console.log('Sign in with the Plex account that OWNS the server if you want');
console.log("all users' watch history; a shared account only ever sees its own.");
console.log('');

const child = spawn('npx', ['next', 'dev', '-p', port], {
  stdio: 'inherit',
  // Node 20+ refuses to spawn a .cmd without a shell, which is how npx ships
  // on Windows; harmless elsewhere and keeps this one code path.
  shell: true,
  env: {
    ...process.env,
    DATA_DIR: dataDir,
    // A fixed fallback keeps sessions, and the tokens lib/crypto.ts encrypts
    // with this secret, valid across restarts.
    SESSION_SECRET:
      process.env.SESSION_SECRET?.trim() || 'keeparr-dev-real-secret-change-me',
    NODE_NO_WARNINGS: '1',
  },
});
child.on('exit', (code) => process.exit(code ?? 0));
