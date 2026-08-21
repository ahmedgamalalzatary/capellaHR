import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { EmployeeSettlementPanel } from '../src/features/employees/components/employee-settlement-panel';
import type { Employee } from '../src/features/employees/api/employees-api';

const mocks = vi.hoisted(() => ({
  listEmployeeDebts: vi.fn(),
  settleEmployeeDebt: vi.fn(),
  getEmployeeSettlement: vi.fn(),
}));

vi.mock('../src/features/employees/api/employees-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...mocks,
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const employee = { id: 4, employeeCode: 12, fullName: 'أحمد' } as Employee;

const statement = {
  employee: { id: 4, employeeCode: 12, fullName: 'أحمد' },
  reason: 'استقالة',
  lastWorkingDay: '2026-08-19',
  terminatedAt: '2026-08-19T18:00:00.000Z',
  netSalaryBeforeSettlement: '1500.00',
  advancesRecovered: '3000.00',
  writeOffAmount: '0.00',
  forfeitedSalaryAmount: '0.00',
  cashCollectedAmount: '0.00',
  debtRecordedAmount: '1000.00',
  finalNetSalary: '-1000.00',
};

const renderPanel = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <EmployeeSettlementPanel employee={employee} onClose={vi.fn()} />
  </QueryClientProvider>,
);

describe('EmployeeSettlementPanel', () => {
  test('separates unpaid debts from ones already paid', async () => {
    mocks.listEmployeeDebts.mockResolvedValue([
      { id: 7, payrollMonth: '2026-08-01', amount: '450.00', createdAt: '2026-08-19T12:00:00.000Z', settledAt: null },
      { id: 6, payrollMonth: '2026-07-01', amount: '300.00', createdAt: '2026-07-31T12:00:00.000Z', settledAt: '2026-08-01T12:00:00.000Z' },
    ]);
    mocks.getEmployeeSettlement.mockRejectedValue(new Error('no termination'));

    renderPanel();

    await waitFor(() => expect(screen.getByText('450.00 ج')).toBeTruthy());
    // Only the unpaid one can be paid.
    expect(screen.getAllByRole('button', { name: 'تسجيل السداد' })).toHaveLength(1);
    expect(screen.getByText(/تم السداد/)).toBeTruthy();
  });

  test('marks a debt as paid and refreshes the list', async () => {
    mocks.listEmployeeDebts.mockResolvedValue([
      { id: 7, payrollMonth: '2026-08-01', amount: '450.00', createdAt: '2026-08-19T12:00:00.000Z', settledAt: null },
    ]);
    mocks.getEmployeeSettlement.mockRejectedValue(new Error('no termination'));
    mocks.settleEmployeeDebt.mockResolvedValue({ id: 7, settledAt: '2026-08-20T09:00:00.000Z' });

    renderPanel();

    await waitFor(() => expect(screen.getByRole('button', { name: 'تسجيل السداد' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل السداد' }));

    await waitFor(() => expect(mocks.settleEmployeeDebt).toHaveBeenCalledWith(4, 7));
  });

  test('shows the frozen settlement figures when the employee has left', async () => {
    mocks.listEmployeeDebts.mockResolvedValue([]);
    mocks.getEmployeeSettlement.mockResolvedValue(statement);

    renderPanel();

    await waitFor(() => expect(screen.getByText('استقالة')).toBeTruthy());
    expect(screen.getByText('2026-08-19')).toBeTruthy();
    expect(screen.getByText('-1000.00 ج')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'طباعة' })).toBeTruthy();
  });

  test('keeps the print button off the printed statement', async () => {
    // The print rule reveals everything inside .print-statement, so a button left in
    // there is printed onto the employee's settlement sheet.
    mocks.listEmployeeDebts.mockResolvedValue([]);
    mocks.getEmployeeSettlement.mockResolvedValue(statement);

    renderPanel();

    await waitFor(() => expect(screen.getByText('استقالة')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'طباعة' }).className).toContain('print:hidden');
  });
});
