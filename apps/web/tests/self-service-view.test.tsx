import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';

const mocks = vi.hoisted(() => ({
  getOverview: vi.fn(),
  listAttendance: vi.fn(),
  listWeeklyDays: vi.fn(),
  getPayrollMonth: vi.fn(),
  getCommissionMonth: vi.fn(),
  listBonuses: vi.fn(),
  listDeductions: vi.fn(),
  listAdvances: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('../src/features/employee-self-service/api/self-service-api', () => ({
  getSelfServiceOverview: mocks.getOverview,
  listSelfServiceAttendance: mocks.listAttendance,
  listSelfServiceWeeklyDays: mocks.listWeeklyDays,
  getSelfServicePayrollMonth: mocks.getPayrollMonth,
  getSelfServiceCommissionMonth: mocks.getCommissionMonth,
  listSelfServiceBonuses: mocks.listBonuses,
  listSelfServiceDeductions: mocks.listDeductions,
  listSelfServiceAdvances: mocks.listAdvances,
}));

vi.mock('../src/features/auth/api/auth-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  logout: mocks.logout,
}));

import { SelfServiceView } from '../src/features/employee-self-service/components/self-service-view';

const pageOf = (items: unknown[]) => ({
  items,
  meta: { page: 1, pageSize: 20, total: items.length, totalPages: items.length ? 1 : 0 },
});

const overview = {
  profile: {
    employeeCode: 42,
    fullName: 'أحمد جمال',
    personalPhone: '01012345678',
    whatsappPhone: '01112345678',
    age: 31,
    address: 'القاهرة',
  },
  branch: { name: 'الفرع الرئيسي', location: 'وسط البلد' },
  shift: { durationMinutes: 480 },
  baseSalary: { amount: '5000.00', currency: 'EGP' as const },
};

const renderView = (retry: false | number = false) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry, retryDelay: 0 }, mutations: { retry: false } },
  });
  return {
    ...render(
    <QueryClientProvider client={queryClient}>
      <SelfServiceView />
    </QueryClientProvider>,
    ),
    queryClient,
  };
};

const noRetryCases = [
  { name: 'overview', read: mocks.getOverview, tabIndex: null, queryKey: ['self-service', 'overview'] },
  { name: 'attendance', read: mocks.listAttendance, tabIndex: 1, queryKey: ['self-service', 'attendance', 1] },
  { name: 'weekly days', read: mocks.listWeeklyDays, tabIndex: 2, queryKey: ['self-service', 'weekly-days', 1] },
  { name: 'adjustments', read: mocks.listBonuses, tabIndex: 5, queryKey: ['self-service', 'bonuses', 1] },
  { name: 'advances', read: mocks.listAdvances, tabIndex: 7, queryKey: ['self-service', 'advances', 1] },
] as const;

beforeEach(() => {
  mocks.getOverview.mockResolvedValue(overview);
  mocks.listAttendance.mockResolvedValue(pageOf([{
    id: 11,
    attendanceDate: '2026-07-20',
    state: 'closed',
    requiredMinutes: 480,
    checkInAt: '2026-07-20T06:00:00.000Z',
    checkOutAt: '2026-07-20T14:00:00.000Z',
    workedMinutes: 480,
    overtimeMinutes: 0,
    shortageMinutes: 0,
  }]));
  mocks.listWeeklyDays.mockResolvedValue(pageOf([
    { id: 1, attendanceDate: '2026-07-01', status: 'weekly_day_off', requiredMinutes: 480, dayOffConvertedAt: '2026-07-02T00:00:00.000Z' },
  ]));
  mocks.getPayrollMonth.mockResolvedValue({
    payrollMonth: '2026-06', status: 'finalized', baseSalary: '5000.00', proratedBase: '5000.00',
    overtimeAmount: '100.00', bonusAmount: '75.00', commissionAmount: '300.00',
    attendanceDeductionAmount: '25.00', manualDeductionAmount: '20.00', commissionDeductionAmount: '50.00',
    advanceAmount: '500.00', priorNegativeCarry: '0.00', netSalary: '4880.00', eligibleWorkdays: 26,
    fullMonthWorkdays: 26, requiredMinutes: 12480, overtimeMinutes: 60, shortageMinutes: 0,
    finalizedAt: '2026-07-01T00:00:00.000Z',
  });
  mocks.getCommissionMonth.mockResolvedValue({
    available: true, payrollMonth: '2026-08', earnedAmount: '300.00', reversedAmount: '50.00',
    netAmount: '250.00', invoiceLineCount: 3, reversalCount: 1,
  });
  mocks.listBonuses.mockResolvedValue(pageOf([{ id: 1, payrollMonth: '2026-07', amount: '100.00', createdAt: '', updatedAt: '' }]));
  mocks.listDeductions.mockResolvedValue(pageOf([{
    id: 2, payrollMonth: '2026-07', amount: '20.00', reason: 'Late arrival', createdAt: '', updatedAt: '',
  }]));
  mocks.listAdvances.mockResolvedValue(pageOf([{
    id: 3, amount: '200.00', installmentCount: 2, startMonth: '2026-07',
    installments: [
      { ordinal: 1, payrollMonth: '2026-07', amount: '100.00' },
      { ordinal: 2, payrollMonth: '2026-08', amount: '100.00' },
    ],
    createdAt: '', updatedAt: '',
  }]));
  mocks.logout.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SelfServiceView', () => {
  it('shows the reason for a deduction', async () => {
    renderView();
    await waitFor(() => expect(mocks.getOverview).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getAllByRole('tab')[6]!);
    expect(await screen.findByText('Late arrival')).toBeDefined();
  });

  it.each(noRetryCases)('does not retry $name queries when the application default allows retries', async ({ read, tabIndex, queryKey }) => {
    read.mockRejectedValue(new Error('request failed'));
    const { queryClient } = renderView(1);

    if (tabIndex !== null) {
      await waitFor(() => expect(mocks.getOverview).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getAllByRole('tab')[tabIndex]!);
    }

    await waitFor(() => expect(queryClient.getQueryState(queryKey)?.status).toBe('error'));
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('connects each selected tab to the active tabpanel', async () => {
    renderView();
    await waitFor(() => expect(mocks.getOverview).toHaveBeenCalledTimes(1));

    const overviewTab = screen.getAllByRole('tab')[0]!;
    expect(overviewTab.id).toBe('self-service-tab-overview');
    expect(overviewTab.getAttribute('aria-controls')).toBe('self-service-panel-overview');
    expect(overviewTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').id).toBe('self-service-panel-overview');
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(overviewTab.id);

    const bonusesTab = screen.getAllByRole('tab')[5]!;
    fireEvent.click(bonusesTab);
    expect(bonusesTab.id).toBe('self-service-tab-bonuses');
    expect(bonusesTab.getAttribute('aria-controls')).toBe('self-service-panel-bonuses');
    expect(bonusesTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').id).toBe('self-service-panel-bonuses');
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(bonusesTab.id);
  });

  it('uses roving focus and RTL keyboard navigation across the tabs', async () => {
    renderView();
    await waitFor(() => expect(mocks.getOverview).toHaveBeenCalledTimes(1));

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1, -1, -1, -1, -1]);

    tabs[0]!.focus();
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(tabs[1]!, { key: 'End' });
    expect(document.activeElement).toBe(tabs[7]);
    expect(tabs[7]!.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(tabs[7]!, { key: 'Home' });
    expect(document.activeElement).toBe(tabs[0]);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
  });

  it('shows the employee identity, assignment, and salary without admin or export controls', async () => {
    renderView();

    expect(await screen.findByText('أحمد جمال')).toBeDefined();
    expect(screen.getByText('#42')).toBeDefined();
    expect(screen.getByText('الفرع الرئيسي')).toBeDefined();
    expect(screen.getByText('8 ساعات')).toBeDefined();
    expect(screen.getByText(/5000\.00/)).toBeDefined();
    expect(screen.queryByText(/صورة|الرقم السري|بيانات الجهاز/)).toBeNull();
    expect(screen.queryByRole('button', { name: /تعديل|حذف|إضافة|اعتماد|طباعة|تصدير/ })).toBeNull();
  });

  it('lets the employee browse only their read-only histories', async () => {
    renderView();
    await screen.findByText('أحمد جمال');

    fireEvent.click(screen.getByRole('tab', { name: 'الحضور' }));
    expect(await screen.findByText('2026-07-20')).toBeDefined();
    expect(screen.getByText('مغلق')).toBeDefined();

    fireEvent.click(screen.getByRole('tab', { name: 'أيام الراحة والغياب' }));
    expect(await screen.findByText('2026-07-01')).toBeDefined();

    fireEvent.click(screen.getByRole('tab', { name: 'المكافآت' }));
    expect(await screen.findByText(/100\.00/)).toBeDefined();

    fireEvent.click(screen.getByRole('tab', { name: 'الخصومات' }));
    expect(await screen.findByText(/20\.00/)).toBeDefined();

    fireEvent.click(screen.getByRole('tab', { name: 'السلف' }));
    expect(await screen.findByText('قسط 1')).toBeDefined();
    expect(screen.getByText('2026-08')).toBeDefined();
  });

  it('paginates long own-record histories', async () => {
    mocks.listBonuses.mockResolvedValue({
      items: [{ id: 1, payrollMonth: '2026-07', amount: '100.00', createdAt: '', updatedAt: '' }],
      meta: { page: 1, pageSize: 20, total: 21, totalPages: 2 },
    });
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('tab', { name: 'المكافآت' }));
    await screen.findByText(/100\.00/);

    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));

    await waitFor(() => expect(mocks.listBonuses).toHaveBeenLastCalledWith({ page: 2 }));
  });

  it('loads a selected payroll month and explains unavailable open calculations', async () => {
    mocks.getPayrollMonth.mockRejectedValue(new ApiError(503, {
      code: 'PAYROLL_ATTENDANCE_UNAVAILABLE',
      message: 'تعذر التحقق من بيانات الحضور للراتب',
    }));
    renderView();
    await screen.findByText('أحمد جمال');

    fireEvent.click(screen.getByRole('tab', { name: 'الراتب' }));
    fireEvent.change(screen.getByLabelText('شهر الراتب'), { target: { value: '2026-07' } });
    fireEvent.click(screen.getByRole('button', { name: 'عرض الراتب' }));

    await waitFor(() => expect(mocks.getPayrollMonth).toHaveBeenCalledWith('2026-07'));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'تعذر التحقق من بيانات الحضور للراتب');
  });

  it('shows commission income and post-payroll commission deductions in payroll', async () => {
    renderView();
    await screen.findByText('أحمد جمال');

    fireEvent.click(screen.getByRole('tab', { name: 'الراتب' }));
    fireEvent.change(screen.getByLabelText('شهر الراتب'), { target: { value: '2026-06' } });
    fireEvent.click(screen.getByRole('button', { name: 'عرض الراتب' }));

    expect(await screen.findByText('خصومات عمولات سابقة')).toBeDefined();
    expect(screen.getAllByText('العمولات')).toHaveLength(2);
  });

  it('shows the employee own monthly earned, reversed, and net commission totals', async () => {
    renderView();
    await screen.findByText('أحمد جمال');

    fireEvent.click(screen.getByRole('tab', { name: 'العمولات' }));
    fireEvent.change(screen.getByLabelText('شهر العمولة'), { target: { value: '2026-08' } });
    fireEvent.click(screen.getByRole('button', { name: 'عرض العمولات' }));

    await waitFor(() => expect(mocks.getCommissionMonth).toHaveBeenCalledWith('2026-08'));
    expect(await screen.findByText(/250\.00/)).toBeDefined();
    expect(screen.getByText(/300\.00/)).toBeDefined();
    expect(screen.getByText(/^50\.00/)).toBeDefined();
  });

  it('marks commissions unavailable instead of reporting fabricated zero totals in HR-only mode', async () => {
    mocks.getCommissionMonth.mockResolvedValueOnce({ available: false, payrollMonth: '2026-08' });
    renderView();
    await screen.findByText('أحمد جمال');

    fireEvent.click(screen.getByRole('tab', { name: 'العمولات' }));
    fireEvent.change(screen.getByLabelText('شهر العمولة'), { target: { value: '2026-08' } });
    fireEvent.click(screen.getByRole('button', { name: 'عرض العمولات' }));

    expect(await screen.findByText('العمولات غير متاحة في هذه النسخة')).toBeDefined();
    expect(screen.queryByText(/^0\.00/)).toBeNull();
  });

  it('ends the current session from the self-service header', async () => {
    renderView();
    await screen.findByText('أحمد جمال');

    fireEvent.click(screen.getByRole('button', { name: 'تسجيل الخروج' }));

    await waitFor(() => expect(mocks.logout).toHaveBeenCalledTimes(1));
  });
});
