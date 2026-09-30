import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';

const mocks = vi.hoisted(() => ({
  listPayrollMonths: vi.fn(),
  updateBaseSalary: vi.fn(),
  finalizePayroll: vi.fn(),
  finalizeBranchPayroll: vi.fn(),
  listEmployees: vi.fn(),
  listBranches: vi.fn(),
  reconcileAttendanceDay: vi.fn(),
}));

vi.mock('../src/features/payroll/api/payroll-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listPayrollMonths: mocks.listPayrollMonths,
  updateBaseSalary: mocks.updateBaseSalary,
  finalizePayroll: mocks.finalizePayroll,
  finalizeBranchPayroll: mocks.finalizeBranchPayroll,
}));

vi.mock('../src/features/employees/api/employees-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listEmployees: mocks.listEmployees,
}));

vi.mock('../src/features/branches/api/branches-api', () => ({
  listBranches: mocks.listBranches,
}));

vi.mock('../src/features/attendance/api/attendance-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reconcileAttendanceDay: mocks.reconcileAttendanceDay,
}));

import { PayrollView } from '../src/features/payroll/components/payroll-view';

const payroll = {
  id: 7,
  employeeId: 1,
  employeeCode: 1001,
  employeeName: 'أحمد جمال',
  branchId: 3,
  branchName: 'فرع القاهرة',
  payrollMonth: '2026-06',
  status: 'open' as const,
  baseSalary: '6000.00',
  proratedBase: '6000.00',
  overtimeAmount: '150.00',
  bonusAmount: '200.00',
  commissionAmount: '350.00',
  commissionDeductionAmount: '40.00',
  attendanceDeductionAmount: '50.00',
  manualDeductionAmount: '25.00',
  advanceAmount: '500.00',
  priorNegativeCarry: '0.00',
  netSalary: '5775.00',
  eligibleWorkdays: 26,
  fullMonthWorkdays: 26,
  requiredMinutes: 12480,
  overtimeMinutes: 60,
  shortageMinutes: 20,
  finalizedAt: null,
};

const finalized = {
  ...payroll,
  id: 8,
  employeeId: 2,
  employeeCode: 1002,
  employeeName: 'منى علي',
  status: 'finalized' as const,
  finalizedAt: '2026-07-01T10:00:00.000Z',
};

const blocked = {
  state: 'blocked' as const,
  employeeId: 3,
  employeeCode: 1003,
  employeeName: 'سارة محمد',
  branchId: 3,
  branchName: 'فرع القاهرة',
  payrollMonth: '2026-06',
  blockers: ['ATTENDANCE_RECONCILIATION_PENDING'],
  missingAttendanceDates: ['2026-06-03', '2026-06-04'],
};

const employee = {
  id: 1,
  employeeCode: 1001,
  fullName: 'أحمد جمال',
  monthlyBaseSalary: '6000.00',
};

const pageOf = (items: unknown[], meta: Partial<Record<string, number>> = {}) => ({
  items,
  meta: { page: 1, pageSize: 20, total: items.length, totalPages: 1, ...meta },
});

function renderView() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PayrollView />
    </QueryClientProvider>,
  );
}

const rowOf = (name: string) => screen.getByText(name).closest('tr')!;

/** Drives the calendar month picker the way a user does: open it, tap the month. */
async function pickMonth(monthName: string) {
  fireEvent.click(screen.getByRole('button', { name: 'تصفية حسب الشهر' }));
  const grid = await screen.findByRole('group', { name: 'تصفية حسب الشهر' });
  fireEvent.click(within(grid).getByRole('button', { name: monthName }));
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.stubGlobal('scrollTo', vi.fn());
  mocks.listPayrollMonths.mockResolvedValue(pageOf([
    { ...payroll, state: 'ready' as const },
    { ...finalized, state: 'ready' as const },
  ]));
  mocks.listEmployees.mockResolvedValue(pageOf([employee]));
  mocks.listBranches.mockResolvedValue(pageOf([{ id: 3, name: 'فرع القاهرة' }]));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('PayrollView', () => {
  test('lists monthly payrolls with code, branch, net salary, and status', async () => {
    renderView();
    const row = (await screen.findByText('أحمد جمال')).closest('tr')!;
    expect(within(row).getByText('1001')).toBeDefined();
    expect(within(row).getByText('فرع القاهرة')).toBeDefined();
    expect(within(row).getByText(/5775\.00/)).toBeDefined();
    expect(within(row).getByText('مفتوح')).toBeDefined();
    expect(within(rowOf('منى علي')).getByText('معتمد نهائيًا')).toBeDefined();
  });

  test('keeps blocked employees on the payroll page and exposes every missing attendance date', async () => {
    mocks.listPayrollMonths.mockResolvedValue(pageOf([
      { ...payroll, state: 'ready' as const },
      blocked,
    ]));
    renderView();

    const row = (await screen.findByText('سارة محمد')).closest('tr')!;
    expect(within(row).getByText('يحتاج مراجعة الحضور')).toBeDefined();
    fireEvent.click(within(row).getByRole('button', { name: 'مراجعة الأيام' }));
    expect(screen.getByText('2026-06-03')).toBeDefined();
    expect(screen.getByText('2026-06-04')).toBeDefined();
    expect(screen.getAllByRole('button', { name: 'تسجيل غياب' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'إجازة أسبوعية' })).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'تسجيل حضور فعلي' })).toHaveLength(2);
  });

  test('resolves a missing payroll day as an absence and refreshes payroll', async () => {
    mocks.listPayrollMonths.mockResolvedValue(pageOf([blocked]));
    mocks.reconcileAttendanceDay.mockResolvedValue({ status: 'absence' });
    renderView();
    const row = (await screen.findByText('سارة محمد')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'مراجعة الأيام' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'تسجيل غياب' })[0]!);
    expect(mocks.reconcileAttendanceDay).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: 'تسجيل غياب' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'تأكيد تسجيل الغياب' }));
    await waitFor(() => expect(mocks.reconcileAttendanceDay).toHaveBeenCalledWith({
      employeeId: 3,
      attendanceDate: '2026-06-03',
      resolution: 'absence',
    }));
  });

  test('requests the chosen month with search and branch filters', async () => {
    renderView();
    await screen.findByText('أحمد جمال');
    await pickMonth('مايو');
    fireEvent.change(screen.getByLabelText('تصفية حسب الفرع'), { target: { value: '3' } });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'أحمد' } });
    fireEvent.click(screen.getByRole('button', { name: 'بحث' }));
    await waitFor(() => {
      expect(mocks.listPayrollMonths).toHaveBeenLastCalledWith(
        expect.objectContaining({ month: '2026-05', branchId: 3, search: 'أحمد', page: 1 }),
      );
    });
  });

  test('expands a payroll row into the full component breakdown', async () => {
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(within(rowOf('أحمد جمال')).getByRole('button', { name: 'التفاصيل' }));
    expect(screen.getByText('الراتب الأساسي بعد الاستحقاق')).toBeDefined();
    expect(screen.getByText(/150\.00/)).toBeDefined();
    expect(screen.getByText('العمولات')).toBeDefined();
    expect(screen.getByText(/350\.00/)).toBeDefined();
    expect(screen.getByText('خصومات عمولات سابقة')).toBeDefined();
    expect(screen.getByText(/40\.00/)).toBeDefined();
    expect(screen.getByText(/500\.00/)).toBeDefined();
    expect(screen.getByText('الترحيل السالب السابق')).toBeDefined();
  });

  test('expands only the clicked open row when previews share id 0', async () => {
    // The API returns open previews with id 0; row identity must come from employeeId.
    const first = { ...payroll, id: 0, employeeId: 1, employeeName: 'أحمد جمال' };
    const second = { ...payroll, id: 0, employeeId: 2, employeeCode: 1002, employeeName: 'منى علي' };
    mocks.listPayrollMonths.mockResolvedValue(pageOf([first, second]));
    renderView();
    await screen.findByText('منى علي');
    fireEvent.click(within(rowOf('أحمد جمال')).getByRole('button', { name: 'التفاصيل' }));
    expect(screen.getAllByText('الراتب الأساسي')).toHaveLength(1);
  });

  test('finalizes the clicked open row when previews share id 0', async () => {
    mocks.finalizePayroll.mockResolvedValue({ ...payroll, status: 'finalized' });
    const first = { ...payroll, id: 0, employeeId: 1, employeeName: 'أحمد جمال' };
    const second = { ...payroll, id: 0, employeeId: 2, employeeCode: 1002, employeeName: 'منى علي' };
    mocks.listPayrollMonths.mockResolvedValue(pageOf([first, second]));
    renderView();
    await screen.findByText('منى علي');
    fireEvent.click(within(rowOf('منى علي')).getByRole('button', { name: 'اعتماد' }));
    expect(await screen.findByRole('dialog', { name: 'اعتماد راتب منى علي' })).toBeDefined();
  });

  test('finalizes an open employee-month from a dialog instead of inline', async () => {
    mocks.finalizePayroll.mockResolvedValue({ ...payroll, status: 'finalized' });
    renderView();
    await screen.findByText('أحمد جمال');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(within(rowOf('أحمد جمال')).getByRole('button', { name: 'اعتماد' }));
    const dialog = await screen.findByRole('dialog', { name: /اعتماد راتب/ });
    expect(mocks.finalizePayroll).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'تأكيد الاعتماد' }));
    await waitFor(() => expect(mocks.finalizePayroll).toHaveBeenCalledWith(1, '2026-06'));
  });

  test('finalizes a whole branch month from a dialog instead of inline', async () => {
    mocks.finalizeBranchPayroll.mockResolvedValue([]);
    renderView();
    await screen.findByText('أحمد جمال');
    expect(screen.queryByRole('dialog')).toBeNull();
    await pickMonth('يونيو');
    fireEvent.change(screen.getByLabelText('تصفية حسب الفرع'), { target: { value: '3' } });
    fireEvent.click(await screen.findByRole('button', { name: 'اعتماد رواتب الفرع' }));
    const dialog = await screen.findByRole('dialog', { name: 'اعتماد رواتب الفرع' });
    expect(mocks.finalizeBranchPayroll).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'تأكيد اعتماد الفرع' }));
    await waitFor(() => expect(mocks.finalizeBranchPayroll).toHaveBeenCalledWith(3, '2026-06'));
  });

  test('a finalized row offers no finalize action', async () => {
    renderView();
    await screen.findByText('منى علي');
    expect(within(rowOf('منى علي')).queryByRole('button', { name: 'اعتماد' })).toBeNull();
  });

  test('finalizes a whole branch month once a branch is selected', async () => {
    mocks.finalizeBranchPayroll.mockResolvedValue([]);
    renderView();
    await screen.findByText('أحمد جمال');
    expect(screen.queryByRole('button', { name: 'اعتماد رواتب الفرع' })).toBeNull();
    await pickMonth('يونيو');
    fireEvent.change(screen.getByLabelText('تصفية حسب الفرع'), { target: { value: '3' } });
    fireEvent.click(await screen.findByRole('button', { name: 'اعتماد رواتب الفرع' }));
    expect(mocks.finalizeBranchPayroll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد اعتماد الفرع' }));
    await waitFor(() => expect(mocks.finalizeBranchPayroll).toHaveBeenCalledWith(3, '2026-06'));
  });

  test('names the branch and month it is about to finalize', async () => {
    mocks.listBranches.mockResolvedValue(pageOf([
      { id: 3, name: 'فرع القاهرة' },
      { id: 4, name: 'فرع الجيزة' },
    ]));
    renderView();
    await screen.findByText('أحمد جمال');
    await pickMonth('يونيو');
    fireEvent.change(screen.getByLabelText('تصفية حسب الفرع'), { target: { value: '4' } });
    fireEvent.click(await screen.findByRole('button', { name: 'اعتماد رواتب الفرع' }));

    const prompt = screen.getByText(/اعتماد نهائي لرواتب/);
    expect(prompt.textContent).toContain('فرع الجيزة');
    expect(prompt.textContent).toContain('2026-06');
  });

  test('drops a pending branch confirmation when the branch or month changes', async () => {
    mocks.listBranches.mockResolvedValue(pageOf([
      { id: 3, name: 'فرع القاهرة' },
      { id: 4, name: 'فرع الجيزة' },
    ]));
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.change(screen.getByLabelText('تصفية حسب الفرع'), { target: { value: '3' } });
    fireEvent.click(await screen.findByRole('button', { name: 'اعتماد رواتب الفرع' }));
    expect(screen.getByRole('button', { name: 'تأكيد اعتماد الفرع' })).toBeDefined();

    fireEvent.change(screen.getByLabelText('تصفية حسب الفرع'), { target: { value: '4' } });

    expect(screen.queryByRole('button', { name: 'تأكيد اعتماد الفرع' })).toBeNull();

    fireEvent.click(await screen.findByRole('button', { name: 'اعتماد رواتب الفرع' }));
    expect(screen.getByRole('button', { name: 'تأكيد اعتماد الفرع' })).toBeDefined();
    await pickMonth('مايو');

    expect(screen.queryByRole('button', { name: 'تأكيد اعتماد الفرع' })).toBeNull();
    expect(mocks.finalizeBranchPayroll).not.toHaveBeenCalled();
  });

  test('surfaces the Arabic error when attendance facts are unavailable', async () => {
    mocks.listPayrollMonths.mockRejectedValue(new ApiError(503, {
      code: 'PAYROLL_ATTENDANCE_UNAVAILABLE',
      message: 'تعذر التحقق من بيانات الحضور للراتب',
    }));
    renderView();
    expect(await screen.findByText('تعذر التحقق من بيانات الحضور للراتب')).toBeDefined();
    expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeDefined();
  });

  test('surfaces the Arabic error when finalization is rejected', async () => {
    mocks.finalizePayroll.mockRejectedValue(new ApiError(409, {
      code: 'PAYROLL_CHRONOLOGY_CONFLICT',
      message: 'يجب اعتماد الشهور الأقدم أولًا',
    }));
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(within(rowOf('أحمد جمال')).getByRole('button', { name: 'اعتماد' }));
    const dialog = await screen.findByRole('dialog', { name: /اعتماد راتب/ });
    fireEvent.click(within(dialog).getByRole('button', { name: 'تأكيد الاعتماد' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'يجب اعتماد الشهور الأقدم أولًا',
    );
  });

  test('shows an empty state when the month has no payrolls', async () => {
    mocks.listPayrollMonths.mockResolvedValue(pageOf([]));
    renderView();
    expect(await screen.findByText('لا توجد رواتب لهذا الشهر')).toBeDefined();
  });

  test('picks the month from the calendar instead of a raw month input', async () => {
    renderView();
    await screen.findByText('أحمد جمال');

    // A payroll month is always one month, so there is no free-text entry.
    expect(screen.queryByLabelText('شهر الاستحقاق', { selector: 'input' })).toBeNull();

    await pickMonth('مايو');

    await waitFor(() => {
      const params = mocks.listPayrollMonths.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(params).toMatchObject({ month: '2026-05' });
    });
  });

  test('keeps the chosen month when the picker is cleared', async () => {
    renderView();
    await screen.findByText('أحمد جمال');
    await pickMonth('مايو');
    await waitFor(() => {
      const params = mocks.listPayrollMonths.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(params).toMatchObject({ month: '2026-05' });
    });

    fireEvent.click(screen.getByRole('button', { name: 'تصفية حسب الشهر' }));
    fireEvent.click(await screen.findByRole('button', { name: 'مسح الشهر' }));

    // A fresh search proves the retained month is used by a new request.
    mocks.listPayrollMonths.mockClear();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'أحمد' } });
    fireEvent.click(screen.getByRole('button', { name: 'بحث' }));
    await waitFor(() => {
      expect(mocks.listPayrollMonths).toHaveBeenCalledWith(
        expect.objectContaining({ month: '2026-05', search: 'أحمد', page: 1 }),
      );
    });
  });

  test('paginates the payroll list with the next button', async () => {
    mocks.listPayrollMonths.mockResolvedValue(pageOf([payroll], { total: 30, totalPages: 2 }));
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    await waitFor(() => {
      const params = mocks.listPayrollMonths.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(params).toMatchObject({ page: 2 });
      expect(params).not.toHaveProperty('pageSize');
    });
  });

  test('prints one employee sheet from that row and keeps the button off it', async () => {
    const printedSheets: (Element | null)[] = [];
    const print = vi.fn(() => {
      const sheet = document.querySelector('.print-statement');
      printedSheets.push(sheet ? sheet.cloneNode(true) as Element : null);
    });
    vi.stubGlobal('print', print);
    renderView();
    await screen.findByText('أحمد جمال');

    // Printing is per employee, so the button lives on the row, not on the card.
    const row = rowOf('أحمد جمال');
    const button = within(row).getByRole('button', { name: 'طباعة' });
    expect(within(rowOf('منى علي')).queryByRole('button', { name: 'طباعة' })).not.toBeNull();

    // Nothing is armed for printing before a row asks for it.
    expect(document.querySelector('.print-statement')).toBeNull();

    fireEvent.click(button);

    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    // The sheet carries this employee's full breakdown, and nobody else's.
    const sheet = printedSheets[0];
    expect(sheet).not.toBeNull();
    expect(sheet!.textContent).toContain('أحمد جمال');
    expect(sheet!.textContent).toContain('الراتب الأساسي');
    expect(sheet!.textContent).toContain('صافي الراتب');
    expect(sheet!.textContent).not.toContain('منى علي');

    // It prints as a ruled table, not a loose list of label/value pairs.
    const table = sheet!.querySelector('table');
    expect(table).not.toBeNull();
    // Every body row carries a rule, so the lines are drawn rather than implied.
    const rows = table!.querySelectorAll('tbody tr');
    expect(rows.length).toBe(17);
    for (const row of Array.from(rows)) {
      expect(row.className).toContain('border-b');
    }
    expect(table!.querySelector('th')?.textContent).toBe('البيان');
    expect(table!.querySelectorAll('th')[1]?.textContent).toBe('المبلغ');
    // Money aligns in a column, so the figures are easy to scan down the page.
    expect(table!.querySelector('td:last-child')?.className).toContain('text-end');

  });

  test('prints the other employee when that row is the one asked for', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    renderView();
    await screen.findByText('منى علي');

    fireEvent.click(within(rowOf('منى علي')).getByRole('button', { name: 'طباعة' }));

    const sheet = document.querySelector('.print-statement');
    expect(sheet!.textContent).toContain('منى علي');
    expect(sheet!.textContent).not.toContain('أحمد جمال');
    await waitFor(() => expect(print).toHaveBeenCalled());
  });

  test('prints the same employee again when their row is asked twice', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    renderView();
    await screen.findByText('أحمد جمال');

    fireEvent.click(within(rowOf('أحمد جمال')).getByRole('button', { name: 'طباعة' }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));

    // The first print must not leave the selection armed, or asking again changes
    // nothing and the employee silently gets no second sheet.
    fireEvent.click(within(rowOf('أحمد جمال')).getByRole('button', { name: 'طباعة' }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(2));
  });

  test('prints the sheet as it stands at the moment print runs', async () => {
    // Captured inside the mock: checking the DOM afterwards would pass even if print
    // fired before React had rendered the sheet.
    const printed: (string | null)[] = [];
    vi.stubGlobal('print', vi.fn(() => {
      printed.push(document.querySelector('.print-statement')?.textContent ?? null);
    }));
    renderView();
    await screen.findByText('أحمد جمال');

    fireEvent.click(within(rowOf('منى علي')).getByRole('button', { name: 'طباعة' }));

    await waitFor(() => expect(printed).toHaveLength(1));
    // The sheet already carries this employee when the dialog opens, so it cannot
    // come out blank and it cannot be another employee's figures.
    expect(printed[0]).toContain('منى علي');
    expect(printed[0]).not.toContain('أحمد جمال');
  });

  test('stops printing once the armed employee is no longer on the page', async () => {
    // Page 2 must genuinely hold a different employee, or the armed one is still
    // on screen and the test would prove nothing about the stale selection.
    const other = { ...payroll, id: 77, employeeId: 2, employeeName: 'منى علي' };
    mocks.listPayrollMonths.mockImplementation(({ page }: { page?: number } = {}) =>
      Promise.resolve(page === 1
        ? pageOf([{ ...payroll, state: 'ready' as const }], { page: 1, total: 30, totalPages: 2 })
        : pageOf([{ ...other, state: 'ready' as const }], { page: 2, total: 30, totalPages: 2 })),
    );
    const print = vi.fn();
    vi.stubGlobal('print', print);
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(within(rowOf('أحمد جمال')).getByRole('button', { name: 'طباعة' }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));

    // Page away, so the armed employee is gone. Nothing may print without a new click.
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    await screen.findByText('منى علي');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(print).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.print-statement')).toBeNull();
  });

  test('does not print a stale selection when an employee returns to the page', async () => {
    const other = { ...payroll, id: 77, employeeId: 2, employeeName: 'منى علي' };
    mocks.listPayrollMonths.mockImplementation(({ page }: { page?: number } = {}) =>
      Promise.resolve(page === 1
        ? pageOf([{ ...payroll, state: 'ready' as const }], { page: 1, total: 30, totalPages: 2 })
        : pageOf([{ ...other, state: 'ready' as const }], { page: 2, total: 30, totalPages: 2 })),
    );
    const print = vi.fn();
    vi.stubGlobal('print', print);
    renderView();
    await screen.findByText('أحمد جمال');

    fireEvent.click(within(rowOf('أحمد جمال')).getByRole('button', { name: 'طباعة' }));
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    await screen.findByText('منى علي');
    expect(print).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'السابق' }));
    await screen.findByText('أحمد جمال');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(print).not.toHaveBeenCalled();
    expect(document.querySelector('.print-statement')).toBeNull();
  });

  test('offers no print on a row still waiting on attendance', async () => {
    mocks.listPayrollMonths.mockResolvedValue(pageOf([blocked]));
    renderView();
    await screen.findByText('سارة محمد');
    // There is no payroll to print until the blocking days are resolved.
    expect(within(rowOf('سارة محمد')).queryByRole('button', { name: 'طباعة' })).toBeNull();
  });
});
