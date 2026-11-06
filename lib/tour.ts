/**
 * The Keep-page guided tour: step copy + which steps can run right now.
 * Pure (no DOM) so it is unit tested; components/Tour.tsx renders it.
 *
 * A step's `target` is the value of a `data-tour="..."` attribute on the page.
 * `null` = a centered popup with nothing spotlighted.
 */

export type TourPlacement = 'top' | 'bottom' | 'left' | 'right';

/** A real copy of a card control, drawn in the popup so people know what to look for. */
export interface TourHint {
  badge: 'watched' | 'ok-to-delete';
  text: string;
}

export interface TourStep {
  id: string;
  target: string | null;
  title: string;
  /** Paragraphs. A `{term, text}` paragraph renders `term` in bold before `text`. */
  body: (string | { term: string; text: string })[];
  placement: TourPlacement;
  hints?: TourHint[];
  /** If this step can't run (its target isn't on screen), show `hint` on step
   *  `step` instead, so the control is still explained before it ever appears. */
  fallback?: { step: string; hint: TourHint };
}

export function buildTourSteps(opts: { isAdmin: boolean }): TourStep[] {
  const tabs: TourStep['body'] = [
    { term: 'Browse', text: 'search and filter the whole library, and change any decision you made here.' },
    { term: 'Big Picture', text: 'server-wide totals - what is kept, what nobody has watched.' },
  ];
  // Both tabs are admin-only in the rail too, so other people never hear of them.
  if (opts.isAdmin) {
    tabs.push(
      { term: 'Problems', text: '(admins) files the server and Sonarr/Radarr disagree about.' },
      { term: 'Settings', text: '(admins) connections, users, scheduled jobs.' }
    );
  }

  return [
    {
      id: 'welcome',
      target: null,
      title: 'Welcome to Keeparr',
      body: [
        'The server is filling up. Keeparr asks everyone what they want to keep, so the owner knows what is safe to clear out.',
        'Keeparr never deletes anything itself. This quick tour shows you how it works.',
      ],
      placement: 'bottom',
    },
    {
      id: 'filters',
      target: 'feed-filters',
      title: 'Pick what to look at',
      body: [
        '"For you" mixes titles from every library. Pick a library to focus on just that one.',
        '"Largest" lists the biggest titles on the server.',
      ],
      placement: 'bottom',
    },
    {
      id: 'card',
      target: 'feed-card',
      title: 'Tap a poster to keep it',
      body: [
        'Tap again to undo. If anyone keeps a title, it is safe - and you can only undo your own keep.',
      ],
      hints: [{ badge: 'watched', text: 'This badge in the corner means you have watched it.' }],
      placement: 'right',
    },
    {
      id: 'ok-to-delete',
      target: 'feed-card-delete',
      title: 'You requested this one',
      body: [
        'When you are finished with something you asked for, mark it "OK to delete" so the owner knows.',
        'It never overrides anyone else: if someone keeps it, it stays.',
      ],
      placement: 'right',
      fallback: {
        step: 'card',
        hint: {
          badge: 'ok-to-delete',
          text: 'Titles you requested get this button. Press it when you are done with one - it never overrides anyone else\'s keep.',
        },
      },
    },
    {
      id: 'next',
      target: 'feed-next',
      title: 'Then press Next',
      body: [
        'Everything on screen you did not keep is marked "I don\'t care", and a fresh set loads.',
        'Nothing is deleted, and you can change your mind later in Browse.',
      ],
      placement: 'top',
    },
    {
      id: 'totals',
      target: 'keep-totals',
      title: 'Where the space goes',
      body: [
        'Free disk space, and how each library splits up. "Kept" counts everyone\'s keeps - anything someone keeps is safe.',
        '"I don\'t care" and "Undecided" are only yours: titles nobody has kept, which you passed on or have not looked at yet.',
        '"Your progress" at the bottom is just you.',
      ],
      placement: 'left',
    },
    {
      id: 'rail',
      target: 'nav-rail',
      title: 'The other tabs',
      body: tabs,
      placement: 'right',
    },
    {
      id: 'search',
      target: 'global-search',
      title: 'Looking for something?',
      body: ['Search any title from here. Press / to jump to search, or ? for all keyboard shortcuts.'],
      placement: 'bottom',
    },
    {
      id: 'menu',
      target: 'user-menu',
      title: 'Your menu',
      body: [
        'Switch light/dark theme or color-impaired mode, replay this tour any time, or log out.',
      ],
      placement: 'left',
    },
  ];
}

interface TourCard {
  watched?: boolean;
  requestedByMe?: boolean;
  markedForDeleteByMe?: boolean;
}

export const showsDeleteButton = (c: TourCard) => !!(c.requestedByMe || c.markedForDeleteByMe);

/**
 * Reorder a feed batch for the tour: a watched title first (so the poster step
 * shows the eye badge) and an "OK to delete" title second (so that step has a
 * button to point at). Everything else keeps its order; with no candidate the
 * slot is left alone. Returns a new array.
 */
export function arrangeForTour<T extends TourCard>(items: T[]): T[] {
  const out = [...items];
  const w = out.findIndex((i) => i.watched);
  if (w > 0) out.unshift(...out.splice(w, 1));
  const d = out.findIndex((i, idx) => idx >= 1 && showsDeleteButton(i));
  if (d > 1) out.splice(1, 0, ...out.splice(d, 1));
  return out;
}

/**
 * Whether the Keep page should open the tour now: a `?tour=1` replay not yet
 * handled, else the account's first visit. Never on a phone - the tour points
 * at desktop layout (rail, totals column) - and a phone visit does not count
 * as having seen it, so the first desktop visit still runs it.
 */
export function tourStart(s: {
  replay: boolean;
  replayHandled: boolean;
  tourDone: boolean;
  mobile: boolean;
}): 'replay' | 'first' | null {
  if (s.mobile) return null;
  if (s.replay && !s.replayHandled) return 'replay';
  return s.tourDone ? null : 'first';
}

/** Drop steps whose target is not on the page right now (totals hidden on a
 *  narrow window, no "OK to delete" button without a request, empty feed). */
export function availableSteps(steps: TourStep[], present: Set<string>): TourStep[] {
  const runs = (s: TourStep) => s.target === null || present.has(s.target);
  const moved = new Map<string, TourHint[]>();
  for (const s of steps) {
    if (!runs(s) && s.fallback) {
      moved.set(s.fallback.step, [...(moved.get(s.fallback.step) ?? []), s.fallback.hint]);
    }
  }
  return steps
    .filter(runs)
    .map((s) => (moved.has(s.id) ? { ...s, hints: [...(s.hints ?? []), ...moved.get(s.id)!] } : s));
}
