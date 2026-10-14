'use client';

import { useEffect, useState } from 'react';

/** Search waits this long after the last keystroke (owner decision: about half a second). */
export const SEARCH_DELAY_MS = 500;

/** The value, once it has stopped changing for `delay` ms. */
export function useDebouncedValue<Value>(value: Value, delay: number = SEARCH_DELAY_MS): Value {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
