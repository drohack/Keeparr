/**
 * Fetch JSON from an external service, failing with a CLEAR message instead of a
 * raw "Unexpected token '<'" SyntaxError when the response isn't JSON. That
 * happens whenever a configured URL points at something that answers with HTML -
 * a Plex web app at `/`, a reverse-proxy login page, the wrong port, etc. Used by
 * every external connector (Plex / Tautulli / Seerr) so they all behave the same.
 */
export async function fetchJson<T = unknown>(
  url: string,
  opts: {
    headers?: Record<string, string>;
    label: string;
    method?: string;
    /** Abort the request after this many ms (default 15s) so a hung upstream
     *  can't stall a page/job indefinitely. */
    timeoutMs?: number;
  }
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { Accept: 'application/json', ...(opts.headers ?? {}) },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError') {
      throw new Error(`${opts.label} timed out`);
    }
    throw e;
  }
  if (!res.ok) throw new Error(`${opts.label} -> HTTP ${res.status}`);
  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.includes('json')) {
    throw new Error(
      `${opts.label} returned ${contentType || 'a non-JSON response'} (HTTP ${res.status}) - check the URL/SSL and credentials`
    );
  }
  return (await res.json()) as T;
}
