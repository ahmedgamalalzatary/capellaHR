import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/features/expenses', () => ({
  ExpensesView: () => null,
}));

import ExpensesPage from '../src/app/(protected)/expenses/page';

describe('expenses page', () => {
  /**
   * A cashier records the spending of their own shift, so the route guard must admit both
   * ERP roles; the API still refuses a correction from anyone but an admin.
   */
  it('admits every ERP account rather than admins only', () => {
    expect(ExpensesPage().props.role).toBeUndefined();
  });
});
