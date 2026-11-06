import { describe, expect, it } from 'vitest';
import { DESKTOP_GRID, MOBILE_GRID, dimsFor } from './keepgrid';

describe('dimsFor - desktop', () => {
  // Results of the algorithm before it took a profile; desktop must not move.
  it.each([
    [1104, 640, 6, 1],
    [1584, 890, 8, 2],
    [3312, 1290, 18, 3],
    [700, 500, 3, 1],
    [351, 650, 1, 1],
  ])('%ix%i -> %i x %i', (w, h, cols, rows) => {
    expect(dimsFor(w, h, DESKTOP_GRID)).toEqual({ cols, rows });
  });
});

describe('dimsFor - mobile', () => {
  // Grid areas measured in the browser for each phone viewport (the viewport
  // minus the top bar, filter chips, Next bar and side padding).
  it.each([
    ['360x780', 336, 627],
    ['375x812', 351, 659],
    ['390x844', 366, 691],
    ['412x915', 388, 763],
  ])('%s fills 3 columns x 3 rows', (_vp, w, h) => {
    expect(dimsFor(w, h, MOBILE_GRID)).toEqual({ cols: 3, rows: 3 });
  });

  it('never budgets more rows than fit', () => {
    for (const [w, h] of [[336, 627], [351, 515], [366, 691], [388, 763]]) {
      const { cols, rows } = dimsFor(w, h, MOBILE_GRID);
      const cardW = (w - (cols - 1) * MOBILE_GRID.gap) / cols;
      const used = rows * (cardW * 1.5 + MOBILE_GRID.labelH) + (rows - 1) * MOBILE_GRID.gap;
      expect(used).toBeLessThanOrEqual(h);
    }
  });

  it('shows fewer cards on a short phone (375x667) rather than shrinking them', () => {
    expect(dimsFor(351, 515, MOBILE_GRID)).toEqual({ cols: 3, rows: 2 });
  });

  it('caps a large area at maxCards', () => {
    const { cols, rows } = dimsFor(740, 1600, MOBILE_GRID);
    expect(cols * rows).toBeLessThanOrEqual(MOBILE_GRID.maxCards!);
  });
});
