import { NextResponse } from 'next/server';
import { AuthError } from './auth';
import { logEvent } from './queries';

/**
 * Convert a thrown error into a JSON response. AuthError (401/403) is expected
 * and returned quietly, as is a SyntaxError (a malformed request body from
 * `req.json()` - any SyntaxError reaching here is treated as one). Anything
 * else is a real failure: it's logged to BOTH the container stdout
 * (`docker logs`) and the app log (Settings -> Logs) so it's actually
 * diagnosable, then returned as a bare 500 - the raw exception text never
 * goes to the client (it can leak paths/hosts/internals).
 *
 * @param context short tag for where it happened (e.g. 'api/admin/settings').
 */
export function errorResponse(e: unknown, context = 'api'): NextResponse {
  if (e instanceof AuthError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  if (e instanceof SyntaxError) {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const message = e instanceof Error ? e.message : String(e);
  // eslint-disable-next-line no-console
  console.error(`[keeparr] ${context} error:`, e);
  try {
    logEvent('error', context, message);
  } catch {
    /* DB unavailable - the console line above is still emitted */
  }
  return NextResponse.json({ error: 'internal_error' }, { status: 500 });
}
