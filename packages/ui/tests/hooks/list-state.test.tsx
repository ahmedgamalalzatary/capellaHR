import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { useDebouncedValue } from '../../src/hooks/use-debounced-value';
import { useListState } from '../../src/hooks/use-list-state';

const defaults = { search: '', status: 'all', branch: '', page: 1, sort: '' };

const setUrl = (search: string) => window.history.replaceState(null, '', `/invoices${search}`);

beforeEach(() => setUrl(''));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useDebouncedValue', () => {
  test('applies 500 ms after the last change only', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 500), { initialProps: { value: 'م' } });
    expect(result.current).toBe('م');
    rerender({ value: 'من' });
    act(() => { vi.advanceTimersByTime(300); });
    rerender({ value: 'منى' });
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current).toBe('م');
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current).toBe('منى');
  });
});

describe('useListState', () => {
  test('reads values from the URL, with defaults for missing ones and numbers kept as numbers', () => {
    setUrl('?status=open&page=3');
    const { result } = renderHook(() => useListState(defaults));
    expect(result.current.values).toEqual({ ...defaults, status: 'open', page: 3 });
  });

  test('a bad number in the URL falls back to the default', () => {
    setUrl('?page=abc');
    const { result } = renderHook(() => useListState(defaults));
    expect(result.current.values.page).toBe(1);
  });

  test('setting a filter writes the URL, drops defaults from it, and goes back to page 1', () => {
    setUrl('?page=4');
    const { result } = renderHook(() => useListState(defaults));
    act(() => result.current.set({ status: 'paid' }));
    expect(window.location.search).toBe('?status=paid');
    expect(result.current.values.page).toBe(1);
    expect(window.location.pathname).toBe('/invoices');
  });

  test('changing only the page keeps the filters', () => {
    const { result } = renderHook(() => useListState(defaults));
    act(() => result.current.set({ status: 'paid' }));
    act(() => result.current.setPage(2));
    expect(new URLSearchParams(window.location.search).get('status')).toBe('paid');
    expect(result.current.values.page).toBe(2);
  });

  test('counts active filters (not page or sort) and resets them all', () => {
    const { result } = renderHook(() => useListState(defaults));
    expect(result.current.isFiltered).toBe(false);
    act(() => result.current.set({ status: 'paid', search: 'منى', sort: 'total:desc' }));
    expect(result.current.isFiltered).toBe(true);
    expect(result.current.activeCount).toBe(2);
    act(() => result.current.reset());
    expect(result.current.values).toEqual({ ...defaults, sort: 'total:desc' });
    expect(result.current.isFiltered).toBe(false);
  });

  test('sort is exposed as a sort state and written back as key:direction', () => {
    const { result } = renderHook(() => useListState(defaults));
    act(() => result.current.setSort({ key: 'total', direction: 'desc' }));
    expect(new URLSearchParams(window.location.search).get('sort')).toBe('total:desc');
    expect(result.current.sort).toEqual({ key: 'total', direction: 'desc' });
    act(() => result.current.setSort(null));
    expect(result.current.sort).toBeNull();
  });

  test('back/forward (popstate) updates the values', () => {
    const { result } = renderHook(() => useListState(defaults));
    act(() => {
      setUrl('?status=refunded');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current.values.status).toBe('refunded');
  });

  test('a prefix keeps two lists on one page apart', () => {
    setUrl('?stock.search=x&search=y');
    const { result } = renderHook(() => useListState({ search: '' }, { prefix: 'stock' }));
    expect(result.current.values.search).toBe('x');
    act(() => result.current.set({ search: 'z' }));
    expect(new URLSearchParams(window.location.search).get('search')).toBe('y');
    expect(new URLSearchParams(window.location.search).get('stock.search')).toBe('z');
  });
});
