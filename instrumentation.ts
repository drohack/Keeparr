/**
 * Next.js instrumentation hook. Runs once when the server process boots. We use
 * it to start the background auto-sync scheduler — but only in the Node.js
 * runtime (never the Edge/middleware runtime, which can't load better-sqlite3).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startScheduler } = await import('./lib/scheduler');
    startScheduler();
  }
}
