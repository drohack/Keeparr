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
