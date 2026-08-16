import { describe, expect, it } from 'vitest';

import CashierAccountsLayout from '../src/app/(protected)/cashier-accounts/layout';
import CashierSessionsLayout from '../src/app/(protected)/cashier-sessions/layout';
import CatalogLayout from '../src/app/(protected)/catalog/layout';
import CommissionsLayout from '../src/app/(protected)/commissions/layout';
import ProductsLayout from '../src/app/(protected)/products/layout';
import ReportsLayout from '../src/app/(protected)/reports/layout';
import SuppliersLayout from '../src/app/(protected)/suppliers/layout';

const children = <p>محتوى</p>;

/**
 * A cashier runs their branch: catalog, products and purchases are theirs. Only
 * oversight of other cashiers and the money-analysis screens stay admin-only.
 */
describe('ERP route guards per role', () => {
  it('admits every ERP account to the branch operations routes', () => {
    expect(CatalogLayout({ children }).props.role).toBeUndefined();
    expect(ProductsLayout({ children }).props.role).toBeUndefined();
    expect(SuppliersLayout({ children }).props.role).toBeUndefined();
  });

  it('keeps commissions, reports and cashier accounts admin-only', () => {
    expect(CommissionsLayout({ children }).props.role).toBe('admin');
    expect(ReportsLayout({ children }).props.role).toBe('admin');
    expect(CashierAccountsLayout({ children }).props.role).toBe('admin');
  });

  it('keeps shift oversight admin-only, since a cashier opens their own shift at home', () => {
    expect(CashierSessionsLayout({ children }).props.role).toBe('admin');
  });
});
