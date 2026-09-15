export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: string;
  direction: SortDirection;
}

/**
 * Click cycle for a sortable column header: fresh column starts ascending,
 * second click flips to descending, third click clears sorting.
 * Pure helper so it is unit-testable.
 */
export function getNextSort(current: SortState | null, key: string): SortState | null {
  if (!current || current.key !== key) return { key, direction: 'asc' };
  if (current.direction === 'asc') return { key, direction: 'desc' };
  return null;
}
