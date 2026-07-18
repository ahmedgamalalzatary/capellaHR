/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from 'vitest';

import {
  createPayrollService,
  type PayrollRepository,
} from '../../src/modules/payroll/index.js';

const salary = {
  employeeId: 7, employeeCode: 10, employeeName: 'موظف', branchId: 2,
  branchName: 'فرع', amount: '5000.00', deletedAt: null,
};

const repository = (): PayrollRepository => ({
  getBaseSalary: vi.fn(async () => salary),
  updateBaseSalary: vi.fn(async () => ({ kind: 'success' as const, salary: { ...salary, amount: '6000.00' } })),
  list: vi.fn(async () => ({ kind: 'success' as const, items: [], total: 0 })),
  preview: vi.fn(async () => ({ kind: 'success' as const, payroll: {} as never })),
  finalize: vi.fn(async () => ({ kind: 'success' as const, payroll: {} as never })),
  finalizeBranch: vi.fn(async () => ({ kind: 'success' as const, payrolls: [] })),
  isFinalized: vi.fn(async () => false),
});

describe('payroll service', () => {
  it('reads and updates the active employee base salary', async () => {
    const repo = repository();
    const service = createPayrollService(repo);
    await expect(service.getBaseSalary(7)).resolves.toEqual(salary);
    await expect(service.updateBaseSalary(7, { amount: '6000.00' })).resolves.toMatchObject({ amount: '6000.00' });
  });

  it('fails preview and finalization closed until Attendance is configured', async () => {
    const service = createPayrollService(repository());
    await expect(service.preview(7, '2026-06')).rejects.toMatchObject({
      code: 'PAYROLL_ATTENDANCE_UNAVAILABLE',
      message: 'تعذر التحقق من بيانات الحضور للراتب',
    });
    await expect(service.finalize(7, '2026-06')).rejects.toMatchObject({ code: 'PAYROLL_ATTENDANCE_UNAVAILABLE' });
    await expect(service.finalizeBranch(2, '2026-06')).rejects.toMatchObject({ code: 'PAYROLL_ATTENDANCE_UNAVAILABLE' });
  });

  it('delegates with an explicitly configured transaction-aware Attendance gateway', async () => {
    const repo = repository();
    const attendance = { readPayrollFacts: vi.fn(async () => ({ kind: 'ready' as const, facts: {} as never })) };
    const service = createPayrollService(repo, attendance);
    await service.preview(7, '2026-06');
    expect(repo.preview).toHaveBeenCalledWith(7, '2026-06', attendance);
  });
});
