import { describe, expect, it } from 'vitest';
import { arrangeForTour, availableSteps, buildTourSteps } from './tour';

describe('arrangeForTour', () => {
  type Card = { id: string; watched?: boolean; requestedByMe?: boolean; markedForDeleteByMe?: boolean };
  const ids = (xs: Card[]) => xs.map((x) => x.id);

  it('puts a watched title first and an OK-to-delete title second, rest in order', () => {
    const items: Card[] = [
      { id: 'a' },
      { id: 'b' },
      { id: 'req', requestedByMe: true },
      { id: 'c' },
      { id: 'seen', watched: true },
    ];
    expect(ids(arrangeForTour(items))).toEqual(['seen', 'req', 'a', 'b', 'c']);
  });

  it('counts an already-marked title as having the button', () => {
    const items: Card[] = [{ id: 'a' }, { id: 'b' }, { id: 'm', markedForDeleteByMe: true }];
    expect(ids(arrangeForTour(items))).toEqual(['a', 'm', 'b']);
  });

  it('does not reuse the watched title for the second slot', () => {
    const items: Card[] = [{ id: 'a' }, { id: 'both', watched: true, requestedByMe: true }, { id: 'b' }];
    expect(ids(arrangeForTour(items))).toEqual(['both', 'a', 'b']);
  });

  it('leaves the batch alone when nothing qualifies, and does not mutate input', () => {
    const items: Card[] = [{ id: 'a' }, { id: 'b' }];
    const out = arrangeForTour(items);
    expect(ids(out)).toEqual(['a', 'b']);
    expect(out).not.toBe(items);
  });
});

describe('buildTourSteps', () => {
  it('describes admin-only tabs only to admins', () => {
    const rail = (isAdmin: boolean) =>
      buildTourSteps({ isAdmin })
        .find((s) => s.id === 'rail')!
        .body.map((p) => (typeof p === 'string' ? p : `${p.term} ${p.text}`))
        .join(' ');
    expect(rail(false)).not.toMatch(/Problems|Settings/);
    expect(rail(true)).toMatch(/Problems/);
    expect(rail(true)).toMatch(/Settings/);
  });

  it('has unique ids', () => {
    const ids = buildTourSteps({ isAdmin: true }).map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('availableSteps', () => {
  const steps = buildTourSteps({ isAdmin: false });

  it('drops steps whose target is missing, keeping centered steps and order', () => {
    const present = new Set(['feed-filters', 'feed-next', 'user-menu']);
    expect(availableSteps(steps, present).map((s) => s.id)).toEqual([
      'welcome',
      'filters',
      'next',
      'menu',
    ]);
  });

  it('moves the OK-to-delete hint onto the poster step when its own step is dropped', () => {
    const present = new Set(['feed-card']);
    const card = availableSteps(steps, present).find((s) => s.id === 'card')!;
    expect(card.hints?.map((h) => h.badge)).toEqual(['watched', 'ok-to-delete']);
  });

  it('does not repeat the hint when the OK-to-delete step runs', () => {
    const present = new Set(['feed-card', 'feed-card-delete']);
    const out = availableSteps(steps, present);
    expect(out.find((s) => s.id === 'card')!.hints?.map((h) => h.badge)).toEqual(['watched']);
    expect(out.some((s) => s.id === 'ok-to-delete')).toBe(true);
  });

  it('keeps every step when every target is present', () => {
    const all = new Set(steps.map((s) => s.target).filter((t): t is string => t !== null));
    expect(availableSteps(steps, all)).toHaveLength(steps.length);
  });
});
