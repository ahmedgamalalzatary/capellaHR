"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/** A value to write into a URL param; empty/null/undefined removes the param. */
type ParamValue = string | number | null | undefined;

/**
 * Syncs list query state (page, search, filters) to the URL's search params so
 * the current view is shareable and survives refresh. `get` reads a param;
 * `setParams` merges updates into the existing query and replaces the route
 * (no history entry per keystroke). Empty/null/undefined values clear a param.
 */
export function usePaginationParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const get = useCallback((key: string) => searchParams.get(key), [searchParams]);

  const setParams = useCallback(
    (updates: Record<string, ParamValue>) => {
      const next = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === undefined || value === "") {
          next.delete(key);
        } else {
          next.set(key, String(value));
        }
      }

      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
    },
    [router, pathname, searchParams]
  );

  return { get, setParams };
}
