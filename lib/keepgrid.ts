/**
 * Keep-page grid sizing: how many cards fit a measured area with no scroll.
 * Pure so it can be unit tested; KeepView measures the grid and calls dimsFor.
 *
 * No scroll is a rule, not a look: "Next" marks every shown card "don't care",
 * so every shown card has to be on screen.
 */

export interface GridProfile {
  /** Grid gap in px (must match the grid's gap class). */
  gap: number;
  /** Card height below the 2:3 poster: title + year/size row + padding + border. */
  labelH: number;
  /** Extra height of a card that shows the "OK to delete" button under its label.
   *  Budgeted into EVERY row so any row can be full of such cards. */
  actionH: number;
  /** Default card width; the columns this gives are the starting point. */
  minW: number;
  /** Cards may shrink to this width, but only when that buys another whole row. */
  floorW: number;
  /** Upper bound on cards per batch (rows are dropped to stay under it). */
  maxCards?: number;
}

/** Desktop: cards match Browse (CARD_MIN_W in components/MediaCard.tsx). */
export const DESKTOP_GRID: GridProfile = {
  gap: 12,
  labelH: 56,
  actionH: 34,
  minW: 170,
  floorW: 150,
};

/** Phones (below the md breakpoint), used with MediaCard's `compact` variant:
 *  its label is shorter and its "OK to delete" control sits on the poster, so
 *  it needs no extra row height. labelH must match the compact label's real
 *  height (see MediaCard). Aims at 3 columns x 3 rows on a typical phone. */
export const MOBILE_GRID: GridProfile = {
  gap: 8,
  labelH: 42,
  actionH: 0,
  minW: 105,
  floorW: 105,
  maxCards: 12,
};

/**
 * cols x rows that fill a w x h area with no scroll. Each row is budgeted at
 * the tallest card (poster + label + action). Cards start at `minW` and only
 * shrink (more columns, down to `floorW`) when that gains a whole row.
 */
export function dimsFor(w: number, h: number, p: GridProfile): { cols: number; rows: number } {
  const budgetedH = (cardW: number) => cardW * 1.5 + p.labelH + p.actionH;
  const fit = (cols: number) => {
    const cardW = (w - (cols - 1) * p.gap) / cols;
    return { cols, cardW, rows: Math.max(1, Math.floor((h + p.gap) / (budgetedH(cardW) + p.gap))) };
  };
  let best = fit(Math.max(1, Math.floor((w + p.gap) / (p.minW + p.gap))));
  const maxCols = Math.floor((w + p.gap) / (p.floorW + p.gap));
  for (let c = best.cols + 1; c <= maxCols; c++) {
    const cand = fit(c);
    if (cand.cardW < p.floorW) break;
    if (cand.rows > best.rows) best = cand;
  }
  let rows = best.rows;
  if (p.maxCards && best.cols * rows > p.maxCards) {
    rows = Math.max(1, Math.floor(p.maxCards / best.cols));
  }
  return { cols: best.cols, rows };
}
