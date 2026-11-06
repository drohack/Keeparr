'use client';

import { useSyncExternalStore } from 'react';

/** Below Tailwind's `md` breakpoint: the phone layout. CSS uses `md:` variants
 *  for the same line; JS that has to know (grid sizing, the tour) uses this. */
export const MOBILE_QUERY = '(max-width: 767px)';

export function isMobileNow(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches;
}

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

/** False during SSR and hydration, then the live answer. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, isMobileNow, () => false);
}
