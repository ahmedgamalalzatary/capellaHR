'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import type { SortState } from '../lib/sort';

type ListValue = string | number;
export type ListDefaults = Record<string, ListValue>;

const URL_CHANGE_EVENT = 'capella:urlchange';

const subscribe = (onChange: () => void) => {
  window.addEventListener('popstate', onChange);
  window.addEventListener(URL_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(URL_CHANGE_EVENT, onChange);
  };
};
const readSearch = () => window.location.search;
const readServerSearch = () => '';

/** Keys that never count as a filter: moving pages or re-sorting is not filtering. */
const NOT_FILTERS = new Set(['page', 'pageSize', 'sort']);

const parseSort = (value: string): SortState | null => {
  const [key, direction] = value.split(':');
  return key && (direction === 'asc' || direction === 'desc') ? { key, direction } : null;
};

export interface ListStateOptions {
  /** Namespaces the URL keys (`stock.search`) when one page holds two lists. */
  prefix?: string;
}

/**
 * A list page's search, filters, sort and page, kept in the URL: views are shareable, survive the
 * back button and reloads, and dashboard links can open a filtered view. Values equal to their
 * default are left out of the URL. Any filter change goes back to page 1.
 *
 * Writes use `history.replaceState`, which Next's App Router keeps in sync with its own router,
 * so typing in a search box doesn't stack history entries.
 */
export function useListState<Defaults extends ListDefaults>(defaults: Defaults, options: ListStateOptions = {}) {
  const { prefix } = options;
  const search = useSyncExternalStore(subscribe, readSearch, readServerSearch);
  const param = useCallback((key: string) => (prefix ? `${prefix}.${key}` : key), [prefix]);

  // Callers usually pass an object literal; its contents, not its identity, matter.
  const defaultsKey = JSON.stringify(defaults);
  const stableDefaults = useMemo(() => defaults, [defaultsKey]);

  const values = useMemo(() => {
    const params = new URLSearchParams(search);
    const result: Record<string, ListValue> = {};
    for (const [key, fallback] of Object.entries(stableDefaults)) {
      const raw = params.get(param(key));
      if (raw === null) result[key] = fallback;
      else if (typeof fallback === 'number') {
        const parsed = Number(raw);
        result[key] = raw.trim() !== '' && Number.isFinite(parsed) ? parsed : fallback;
      } else result[key] = raw;
    }
    return result as Defaults;
  }, [search, stableDefaults, param]);

  const write = useCallback((next: Record<string, ListValue>) => {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(next)) {
      const name = param(key);
      if (value === stableDefaults[key] || value === '') params.delete(name);
      else params.set(name, String(value));
    }
    const query = params.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', url);
    window.dispatchEvent(new Event(URL_CHANGE_EVENT));
  }, [param, stableDefaults]);

  /** Change filters (or search/sort); goes back to page 1 unless a page is given. */
  const set = useCallback((patch: Partial<Defaults>) => {
    write({ ...('page' in stableDefaults ? { page: stableDefaults.page } : {}), ...(patch as Record<string, ListValue>) });
  }, [write, stableDefaults]);

  const setPage = useCallback((page: number) => write({ page }), [write]);

  const setSort = useCallback((sort: SortState | null) => {
    set({ sort: sort ? `${sort.key}:${sort.direction}` : '' } as unknown as Partial<Defaults>);
  }, [set]);

  /** Clears every filter and the search; keeps the sort. */
  const reset = useCallback(() => {
    const cleared: Record<string, ListValue> = {};
    for (const [key, fallback] of Object.entries(stableDefaults)) {
      if (key !== 'sort') cleared[key] = fallback;
    }
    write(cleared);
  }, [write, stableDefaults]);

  const activeCount = Object.keys(stableDefaults).filter(
    (key) => !NOT_FILTERS.has(key) && values[key] !== stableDefaults[key],
  ).length;

  const sort = typeof values.sort === 'string' ? parseSort(values.sort) : null;

  return {
    values,
    set,
    setPage,
    setSort,
    sort,
    reset,
    /** True when any filter or the search differs from its default (drives the empty message). */
    isFiltered: activeCount > 0,
    activeCount,
  };
}

export type ListState<Defaults extends ListDefaults> = ReturnType<typeof useListState<Defaults>>;
