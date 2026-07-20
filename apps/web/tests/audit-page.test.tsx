import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';

const mocks = vi.hoisted(() => ({ listAuditEvents: vi.fn() }));

vi.mock('../src/features/audit/api/audit-api', () => ({
  listAuditEvents: mocks.listAuditEvents,
}));

import AuditPage from '../src/app/(admin)/audit/page';

const event = {
  id: 1,
  actorType: 'admin' as const,
  actorIdentifier: 'admin',
  module: 'employees',
  action: 'pin_reset',
  entityType: 'employee',
  entityId: '17',
  beforeState: { fullName: 'أحمد', pinHash: '[REDACTED]' },
  afterState: { fullName: 'أحمد علي', pinHash: '[REDACTED]' },
  relatedIds: { branchId: '3' },
  requestId: 'request-17',
  ipAddress: '127.0.0.1',
  userAgent: 'Chrome Android',
  createdAt: '2026-07-20T10:00:00.000Z',
};

const pageOf = (items: unknown[], meta: Partial<Record<string, number>> = {}) => ({
  items,
  meta: { page: 1, pageSize: 20, total: items.length, totalPages: 1, ...meta },
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuditPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.listAuditEvents.mockResolvedValue(pageOf([event]));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AuditPage', () => {
  test('renders read-only audit metadata and expandable redacted changes', async () => {
    renderPage();
    const row = (await screen.findByText('إعادة تعيين الرقم السري')).closest('tr')!;
    expect(within(row).getByText('الموظفون')).toBeDefined();
    expect(within(row).getByText('المشرف')).toBeDefined();
    expect(within(row).getByText('employee').closest('[dir="ltr"]')?.textContent).toBe('employee #17');
    expect(within(row).getByText('request-17')).toBeDefined();
    fireEvent.click(within(row).getByRole('button', { name: 'عرض التفاصيل' }));
    expect(await screen.findByText(/أحمد علي/)).toBeDefined();
    expect(screen.getAllByText(/\[REDACTED\]/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /حذف|تعديل/ })).toBeNull();
  });

  test('combines search and filters and resets them to defaults', async () => {
    renderPage();
    await screen.findByText('إعادة تعيين الرقم السري');
    fireEvent.change(screen.getByRole('searchbox', { name: 'بحث في سجل المراجعة' }), {
      target: { value: 'أحمد' },
    });
    fireEvent.change(screen.getByLabelText('نوع المنفذ'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('الوحدة'), { target: { value: 'employees' } });
    fireEvent.change(screen.getByLabelText('من تاريخ'), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText('إلى تاريخ'), { target: { value: '2026-07-20' } });
    fireEvent.click(screen.getByRole('button', { name: 'بحث' }));

    await waitFor(() => expect(mocks.listAuditEvents).toHaveBeenLastCalledWith(expect.objectContaining({
      search: 'أحمد', actorType: 'admin', module: 'employees',
      dateFrom: '2026-07-01', dateTo: '2026-07-20', page: 1,
    })));

    fireEvent.click(screen.getByRole('button', { name: 'إعادة ضبط الفلاتر' }));
    await waitFor(() => expect(mocks.listAuditEvents).toHaveBeenLastCalledWith({ page: 1 }));
  });

  test('shows empty and retryable error states', async () => {
    mocks.listAuditEvents.mockRejectedValueOnce(new ApiError(0, {
      code: 'NETWORK_ERROR', message: 'تعذر الاتصال بالخادم',
    })).mockResolvedValueOnce(pageOf([]));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'إعادة المحاولة' }));
    expect(await screen.findByText('لا توجد أحداث مراجعة مطابقة')).toBeDefined();
  });

  test('paginates without overriding the API page size', async () => {
    mocks.listAuditEvents.mockResolvedValue(pageOf([event], { total: 30, totalPages: 2 }));
    renderPage();
    await screen.findByText('إعادة تعيين الرقم السري');
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    await waitFor(() => {
      const params = mocks.listAuditEvents.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(params).toMatchObject({ page: 2 });
      expect(params).not.toHaveProperty('pageSize');
    });
  });
});
