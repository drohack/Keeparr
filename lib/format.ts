/** Format a byte count as "x.xx GB" (gibibytes, two decimals). */
export function formatGB(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  return `${gb.toFixed(2)} GB`;
}

/** Format a byte count with a sensible unit (GB, or TB once large). */
export function formatSize(bytes: number): string {
  const tb = bytes / 1024 ** 4;
  if (tb >= 1) return `${tb.toFixed(2)} TB`;
  return formatGB(bytes);
}

/**
 * Relative timestamp for list views ("just now", "5m ago", "3h ago",
 * "yesterday", "6d ago"), falling back to the locale date past ~30 days.
 * UI convention: render this as the visible text with the absolute
 * `toLocaleString()` in the `title` attribute (hover shows the exact time).
 */
export function formatRelative(unixSec: number, nowMs: number = Date.now()): string {
  const diff = Math.floor(nowMs / 1000) - unixSec;
  if (diff < 0) return new Date(unixSec * 1000).toLocaleString(); // future -> absolute
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 24 * 3600) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 48 * 3600) return 'yesterday';
  if (diff < 30 * 24 * 3600) return `${Math.floor(diff / (24 * 3600))}d ago`;
  return new Date(unixSec * 1000).toLocaleDateString();
}
