import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/features/sales', () => ({
  RefundsView: () => null,
}));

import RefundsPage from '../src/app/(protected)/refunds/page';

describe('refunds page', () => {
  it('passes a valid branchId query parameter as the initial branch selection', async () => {
    const page = await RefundsPage({
      searchParams: Promise.resolve({ branchId: '2' }),
    });

    expect(page.props).toMatchObject({ initialBranchId: 2 });
  });

  it.each([undefined, '', 'invalid', '0', '-1', '2.5'])(
    'leaves the initial branch unset for an absent or invalid branchId (%s)',
    async (branchId) => {
      const page = await RefundsPage({
        searchParams: Promise.resolve({ ...(branchId === undefined ? {} : { branchId }) }),
      });

      expect(page.props.initialBranchId).toBeUndefined();
    },
  );
});
