'use client';

import { useSyncExternalStore } from 'react';

let nowMs = 0;
const listeners = new Set<() => void>();
let interval: ReturnType<typeof setInterval> | undefined;

function ensureTicking() {
  if (interval !== undefined || typeof window === 'undefined') return;
  nowMs = Date.now();
  interval = setInterval(() => {
    nowMs = Date.now();
    for (const listener of listeners) listener();
  }, 1000);
}

function subscribe(listener: () => void) {
  ensureTicking();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && interval !== undefined) {
      clearInterval(interval);
      interval = undefined;
    }
  };
}

function getNow() {
  ensureTicking();
  return nowMs || Date.now();
}

function getServerNow() {
  return 0;
}

/** Wall clock that updates once a second without reading Date.now during render. */
export function useTickingNow(): number {
  return useSyncExternalStore(subscribe, getNow, getServerNow);
}
