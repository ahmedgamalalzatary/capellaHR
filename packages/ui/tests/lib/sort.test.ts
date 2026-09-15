import { describe, expect, test } from 'vitest';

import { getNextSort } from '../../src/lib/sort';

describe('getNextSort', () => {
  test('starts ascending on a fresh column', () => {
    expect(getNextSort(null, 'name')).toEqual({ key: 'name', direction: 'asc' });
  });

  test('toggles asc to desc on the same column', () => {
    expect(getNextSort({ key: 'name', direction: 'asc' }, 'name')).toEqual({
      key: 'name',
      direction: 'desc',
    });
  });

  test('clears after desc so the third click removes sorting', () => {
    expect(getNextSort({ key: 'name', direction: 'desc' }, 'name')).toBeNull();
  });

  test('switching columns starts ascending on the new one', () => {
    expect(getNextSort({ key: 'name', direction: 'desc' }, 'date')).toEqual({
      key: 'date',
      direction: 'asc',
    });
  });
});
