import { describe, expect, it } from 'vitest';

import * as cashierSessions from '../src/features/cashier-sessions';

describe('Cashier-session POS API boundary', () => {
  it('keys the shift history, one shift, and its sales apart from the open shift', () => {
    const keys = Reflect.get(cashierSessions, 'cashierSessionQueryKeys') as {
      current: (branchId?: number) => readonly unknown[];
      list: (branchId: number | undefined, page: number) => readonly unknown[];
      summary: (sessionId: number) => readonly unknown[];
      detail: (sessionId: number) => readonly unknown[];
      report: (sessionId: number) => readonly unknown[];
    };

    expect(new Set([
      JSON.stringify(keys.current(3)),
      JSON.stringify(keys.list(3, 1)),
      JSON.stringify(keys.summary(14)),
      JSON.stringify(keys.detail(14)),
      JSON.stringify(keys.report(14)),
    ]).size).toBe(5);
    // Paging must refetch, so the page belongs in the key.
    expect(keys.list(3, 1)).not.toEqual(keys.list(3, 2));
  });
});
