'use client';

import { useSyncExternalStore } from 'react';

/**
 * Live result of a CSS media query. `fallback` is used on the server and wherever matchMedia is
 * missing (tests), so the first paint is predictable.
 */
export function useMatchMedia(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const media = window.matchMedia(query);
      media.addEventListener('change', onStoreChange);
      return () => media.removeEventListener('change', onStoreChange);
    },
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : fallback),
    () => fallback,
  );
}

/** The shared layout breakpoint for both apps (Tailwind `md`, 768px). */
export const WIDE_QUERY = '(min-width: 48rem)';
