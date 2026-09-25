import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/features/sales', () => ({
  InvoiceHistoryView: () => null,
  RefundsView: () => null,
}));

import InvoicesPage from '../src/app/(protected)/invoices/page';
import RefundsPage from '../src/app/(protected)/refunds/page';

const pages = [
  ['invoices', InvoicesPage],
  ['refunds', RefundsPage],
] as const;

describe('branch-scoped sales pages', () => {
  it('parses the branchId query parameter the same way on every page', async () => {
    for (const [name, Page] of pages) {
      const valid = await Page({ searchParams: Promise.resolve({ branchId: '2' }) });
      expect(valid.props, name).toMatchObject({ initialBranchId: 2 });

      for (const branchId of [undefined, '', 'invalid', '0', '-1', '2.5']) {
        const page = await Page({
          searchParams: Promise.resolve({ ...(branchId === undefined ? {} : { branchId }) }),
        });
        expect(page.props.initialBranchId, `${name} branchId=${String(branchId)}`).toBeUndefined();
      }
    }
  });
});
