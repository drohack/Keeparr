/**
 * Next.js instrumentation hook. Runs once when the server process boots. We use
 * it to start the background auto-sync scheduler — but only in the Node.js
 * runtime (never the Edge/middleware runtime, which can't load better-sqlite3).
 */
const INSECURE_SECRET = 'dev-insecure-session-secret-change-me';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Fail loud if a production deploy is running on the known dev fallback
    // secret — sessions would be forgeable and stored tokens decryptable by
    // anyone. The Docker entrypoint auto-generates one, so this only trips a
    // misconfigured bare `next start`.
    const secret = process.env.SESSION_SECRET;
    if (process.env.NODE_ENV === 'production' && (!secret || secret === INSECURE_SECRET)) {
      console.error(
        '\n*** SECURITY WARNING: SESSION_SECRET is not set (using the insecure ' +
          'default). Sessions are forgeable and stored service tokens are not ' +
          'protected. Set SESSION_SECRET to a long random value (the Docker ' +
          'image does this automatically). ***\n'
      );
    }
    const { startScheduler } = await import('./lib/scheduler');
    startScheduler();
  }
}
