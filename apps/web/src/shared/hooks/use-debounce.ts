import { useEffect, useState } from "react";

/**
 * Returns a debounced copy of `value` that only updates once `delayMs` has
 * passed without further changes. Useful for search inputs so list queries
 * don't fire on every keystroke.
 */
export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [value, delayMs]);

  return debounced;
}
