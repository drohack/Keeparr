/**
 * Next.js instrumentation hook. Runs once when the server process boots. We use
 * it to start the background auto-sync scheduler - but only in the Node.js
 * runtime (never the Edge/middleware runtime, which can't load better-sqlite3).
 */
const INSECURE_SECRET = 'dev-insecure-session-secret-change-me';
/** Below this many chars a set SESSION_SECRET is likely too weak (openssl rand -hex 32 = 64). */
const MIN_SECRET_LENGTH = 32;

/**
 * Validate SESSION_SECRET at boot. Returns an action the caller applies (throw /
 * warn / ok) so it stays pure and unit-testable. In production, a missing or
 * default secret is FATAL - sessions would be forgeable and stored service
 * tokens decryptable by anyone. A set-but-short secret is a warning (it also
 * derives the AES key in lib/crypto.ts). The Docker entrypoint auto-generates a
 * strong secret, so the fatal path only trips a misconfigured bare `next start`.
 */
export function checkSessionSecret(
  secret: string | undefined,
  isProduction: boolean
): { level: 'ok' | 'warn' | 'fatal'; message?: string } {
  const missingOrDefault = !secret || secret === INSECURE_SECRET;
  if (isProduction && missingOrDefault) {
    return {
      level: 'fatal',
      message:
        'SESSION_SECRET is not set (using the insecure default). Sessions would ' +
        'be forgeable and stored service tokens unprotected. Set SESSION_SECRET ' +
        'to a long random value - e.g. `openssl rand -hex 32` (the Docker image ' +
        'does this automatically).',
    };
  }
  if (!missingOrDefault && secret!.length < MIN_SECRET_LENGTH) {
    return {
      level: 'warn',
      message:
        `SESSION_SECRET is only ${secret!.length} chars - use a high-entropy ` +
        'value (e.g. `openssl rand -hex 32`). It signs sessions AND derives the ' +
        'key that encrypts your stored service tokens.',
    };
  }
  return { level: 'ok' };
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const check = checkSessionSecret(
      process.env.SESSION_SECRET,
      process.env.NODE_ENV === 'production'
    );
    if (check.level === 'fatal') {
      // Fail closed: refuse to boot rather than run with forgeable sessions.
      throw new Error(`*** SECURITY: ${check.message} ***`);
    }
    if (check.level === 'warn') {
      console.warn(`\n*** SECURITY WARNING: ${check.message} ***\n`);
    }
    const { startScheduler } = await import('./lib/scheduler');
    startScheduler();
  }
}
