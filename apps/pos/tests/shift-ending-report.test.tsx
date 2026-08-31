import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getCashierSessionReport: vi.fn() }));

vi.mock('../src/features/cashier-sessions/api/cashier-sessions-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getCashierSessionReport: mocks.getCashierSessionReport,
}));

import { ShiftEndingReport } from '../src/features/cashier-sessions';

const summary = {
  id: 14, branchId: 3, branchName: 'الفرع الرئيسي', openedByAccountId: 8,
  openedByUsername: 'cashier.one', openedAt: '2026-08-01T09:30:00.000Z',
  closedAt: '2026-08-01T17:30:00.000Z', closedByAccountId: 8,
  closedByUsername: 'cashier.one', autoClosedAt: null, durationMinutes: 480, saleCount: 2,
  taken: { cash: '400.00', visa: '100.00', instapay: '0.00', vodafone_cash: '0.00' },
  refunded: { cash: '50.00', visa: '0.00', instapay: '0.00', vodafone_cash: '0.00' },
  takenTotal: '500.00', refundedTotal: '50.00', net: '450.00',
};

const fullReport = {
  summary,
  sales: {
    gross: '600.00', returns: '50.00', total: '550.00',
    discount: '25.00', tax: '5.00', net: '530.00',
  },
  expenses: '30.00', collectedPayments: '20.00', creditSales: '100.00',
  netByMethod: {
    cash: '350.00', visa: '100.00', instapay: '0.00', vodafone_cash: '0.00',
  },
};

function renderReport() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ShiftEndingReport sessionId={14} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.getCashierSessionReport.mockReset();
  mocks.getCashierSessionReport.mockResolvedValue(fullReport);
  window.print = vi.fn();
});

afterEach(() => {
  cleanup();
  document.body.classList.remove('printing-report');
  vi.restoreAllMocks();
});

describe('ShiftEndingReport', () => {
  test('shows every required accounting total in a narrow thermal report', async () => {
    renderReport();

    const report = await screen.findByRole('region', { name: 'تقرير نهاية الوردية' });
    expect(report.hasAttribute('data-shift-report')).toBe(true);
    expect(within(report).getByText('الوردية رقم 14')).toBeDefined();
    expect(within(report).getByText('الفرع الرئيسي')).toBeDefined();
    expect(within(report).getAllByText('cashier.one').length).toBeGreaterThan(0);
    expect(within(report).getByText('8 س 0 د')).toBeDefined();
    for (const label of [
      'إجمالي المبيعات قبل الخصم', 'المرتجعات', 'الإجمالي', 'الخصم', 'الضريبة',
      'الصافي', 'المصروفات', 'دفعات محصلة', 'مبيعات آجل',
      'نقدي', 'فيزا', 'إنستاباي', 'محفظة',
    ]) expect(within(report).getByText(label)).toBeDefined();
    for (const amount of ['600.00', '50.00', '550.00', '25.00', '5.00', '530.00', '30.00', '20.00', '100.00', '350.00']) {
      expect(within(report).getAllByText(amount).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText(/INV-/)).toBeNull();
  });

  test('opens the browser print dialog from the report', async () => {
    renderReport();
    fireEvent.click(await screen.findByRole('button', { name: 'طباعة التقرير' }));
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  test('prints from a direct-body sheet and cleans it up after printing', async () => {
    renderReport();
    fireEvent.click(await screen.findByRole('button', { name: 'طباعة التقرير' }));
    expect(document.body.classList.contains('printing-report')).toBe(true);
    expect(document.body.querySelector(':scope > #print-root')).not.toBeNull();

    fireEvent(window, new Event('afterprint'));
    await waitFor(() => expect(document.getElementById('print-root')).toBeNull());
    expect(document.body.classList.contains('printing-report')).toBe(false);
  });

  test('identifies an automatically closed shift', async () => {
    mocks.getCashierSessionReport.mockResolvedValue({
      ...fullReport,
      summary: {
        ...summary, closedByAccountId: null, closedByUsername: null, autoClosedAt: summary.closedAt,
      },
    });
    renderReport();

    expect(await screen.findByText('إغلاق تلقائي بواسطة النظام')).toBeDefined();
  });
});
