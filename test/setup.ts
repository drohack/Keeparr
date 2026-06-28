import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the app at a throwaway temp directory BEFORE any module reads config,
// so tests never touch the real ./data/keeparr.db. Runs once per test file
// (before the file's imports are evaluated).
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'keeparr-test-'));
process.env.SESSION_SECRET = 'test-secret-do-not-use';
