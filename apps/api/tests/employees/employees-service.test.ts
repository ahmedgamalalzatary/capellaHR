/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-return */
import { verify } from 'argon2';
import { describe, expect, it, vi } from 'vitest';

import { createEmployeeService, EmployeeError, type EmployeeRepository } from '../../src/modules/employees/employees-service.js';

const input = {
  fullName: ' أحمد ', personalPhone: '01012345678', whatsappPhone: '01112345678', pin: '1234',
  age: 30, address: ' القاهرة ', branchId: 1, shiftDurationMinutes: 600, monthlyBaseSalary: '5000.00',
  images: {
    personal: { storagePath: 'employees/a.jpg', mimeType: 'image/jpeg', sizeBytes: 10, originalName: 'a.jpg' },
    idFront: { storagePath: 'employees/b.jpg', mimeType: 'image/jpeg', sizeBytes: 10, originalName: 'b.jpg' },
    idBack: { storagePath: 'employees/c.jpg', mimeType: 'image/jpeg', sizeBytes: 10, originalName: 'c.jpg' },
  },
};

const repository = (): EmployeeRepository => ({
  create: vi.fn(async (value) => ({ id: 1, employeeCode: 1, credentialVersion: 1, employmentStatus: 'active' as const, ...value, pinHash: value.pinHash, deletedAt: null, createdAt: new Date(), updatedAt: new Date() })),
  findActiveById: vi.fn(), findIdentityByCode: vi.fn(), list: vi.fn(), update: vi.fn(), softDeleteIfAttendanceClosed: vi.fn(),
  previewDeactivation: vi.fn(), deactivate: vi.fn(), applyPendingDeactivation: vi.fn(), activate: vi.fn(),
  findPhoneOwner: vi.fn(), branchExists: vi.fn(async () => true),
  listDebts: vi.fn(), settleDebt: vi.fn(), findLatestTermination: vi.fn(),
});

/** Deactivation now requires attendance, so tests about anything else stub it as idle. */
const settlementFigures = {
  netSalaryBeforeSettlement: '0.00', advancesRecovered: '0.00', writeOffAmount: '0.00',
  forfeitedSalaryAmount: '0.00', cashCollectedAmount: '0.00', debtRecordedAmount: '0.00',
  finalNetSalary: '0.00',
};

const closedAttendance = () => ({
  hasOpenSession: vi.fn(async () => false),
  hasAnyOpenSession: vi.fn(async () => false),
});

describe('employee service', () => {
  it('hashes the PIN, trims text, and never returns the PIN hash', async () => {
    const repo = repository();
    const employee = await createEmployeeService(repo).create(input);
    const stored = vi.mocked(repo.create).mock.calls[0]![0];
    expect(await verify(stored.pinHash, '1234')).toBe(true);
    expect(employee).not.toHaveProperty('pinHash');
    expect(employee).not.toHaveProperty('pin');
    expect(employee.fullName).toBe('أحمد');
  });

  it.each(['personalPhone', 'whatsappPhone'] as const)('rejects a conflicting %s', async (field) => {
    const repo = repository();
    vi.mocked(repo.findPhoneOwner).mockImplementation(async (phone) => phone === input[field] ? { id: 9 } : null);
    await expect(createEmployeeService(repo).create(input)).rejects.toMatchObject({ code: 'EMPLOYEE_PHONE_EXISTS' });
    expect(repo.findPhoneOwner).toHaveBeenCalledWith(input[field]);
  });

  it('rejects an unknown branch', async () => {
    const repo = repository(); vi.mocked(repo.branchExists).mockResolvedValue(false);
    await expect(createEmployeeService(repo).create(input)).rejects.toMatchObject({ code: 'EMPLOYEE_BRANCH_NOT_FOUND' } satisfies Partial<EmployeeError>);
  });

  it('requests atomic session revocation with a changed PIN', async () => {
    const repo = repository();
    vi.mocked(repo.findActiveById).mockResolvedValue({ id: 1 } as never);
    vi.mocked(repo.update).mockImplementation(async (_id, value) => ({ record: { id: 1, employeeCode: 1, credentialVersion: 1, fullName: 'x', personalPhone: '01012345678', whatsappPhone: '01112345678', age: 1, address: 'x', branchId: 1, shiftDurationMinutes: 1, monthlyBaseSalary: '1.00', images: input.images, deletedAt: null, createdAt: new Date(), updatedAt: new Date(), ...value }, replacedImages: {} } as never));
    await createEmployeeService(repo, { hasOpenSession: vi.fn(async () => false), hasAnyOpenSession: vi.fn(async () => false) }).update(1, { pin: '4321' });
    expect(await verify(vi.mocked(repo.update).mock.calls[0]![1].pinHash!, '4321')).toBe(true);
    expect(vi.mocked(repo.update).mock.calls[0]![2]).toBe(true);
  });

  it('requests an atomic attendance check when changing branch', async () => {
    const repo = repository();
    vi.mocked(repo.findActiveById).mockResolvedValue({ id: 1, branchId: 1 } as never);
    vi.mocked(repo.update).mockResolvedValue({ record: { id: 1, branchId: 2 } as never, replacedImages: {} });
    const attendance = { hasOpenSession: vi.fn(async () => false), hasAnyOpenSession: vi.fn(async () => false) };

    await createEmployeeService(repo, attendance).update(1, { branchId: 2 });

    expect(repo.update).toHaveBeenCalledWith(1, { branchId: 2 }, false, expect.any(Function));
    const check = vi.mocked(repo.update).mock.calls[0]![3]!;
    const context = { transaction: true };
    await check(1, context);
    expect(attendance.hasAnyOpenSession).toHaveBeenCalledWith(1, context);
  });

  it('passes the transfer guard whenever branchId is submitted so the locked row decides', async () => {
    const repo = repository();
    vi.mocked(repo.findActiveById).mockResolvedValue({ id: 1, branchId: 2 } as never);
    vi.mocked(repo.update).mockResolvedValue({ record: { id: 1, branchId: 2 } as never, replacedImages: {} });

    await createEmployeeService(repo, { hasOpenSession: vi.fn(async () => false), hasAnyOpenSession: vi.fn(async () => false) }).update(1, { branchId: 2 });

    expect(vi.mocked(repo.update).mock.calls[0]![3]).toEqual(expect.any(Function));
  });

  it('rejects branch reassignment while the employee is checked in', async () => {
    const repo = repository();
    vi.mocked(repo.findActiveById).mockResolvedValue({ id: 1, branchId: 1 } as never);
    vi.mocked(repo.update).mockImplementation(async (id, _changes, _revoke, hasOpenSession) => (
      await hasOpenSession!(id, {}) ? 'checked_in' : null
    ));
    const attendance = {
      hasOpenSession: vi.fn(async () => false),
      hasAnyOpenSession: vi.fn(async () => true),
    };

    await expect(createEmployeeService(repo, attendance)
      .update(1, { branchId: 2 }))
      .rejects.toMatchObject({ code: 'EMPLOYEE_CHECKED_IN' });
    expect(attendance.hasAnyOpenSession).toHaveBeenCalledWith(1, expect.anything());
    expect(attendance.hasOpenSession).not.toHaveBeenCalled();
  });

  it('rejects reassignment to an unknown branch', async () => {
    const repo = repository();
    vi.mocked(repo.findActiveById).mockResolvedValue({ id: 1, branchId: 1 } as never);
    vi.mocked(repo.update).mockResolvedValue('branch_not_found');

    await expect(createEmployeeService(repo, { hasOpenSession: vi.fn(async () => false), hasAnyOpenSession: vi.fn(async () => false) })
      .update(1, { branchId: 2 }))
      .rejects.toMatchObject({ code: 'EMPLOYEE_BRANCH_NOT_FOUND' });
  });

  it('fails closed when attendance state is unavailable for deletion', async () => {
    const repo = repository(); vi.mocked(repo.findActiveById).mockResolvedValue({ id: 1 } as never);
    await expect(createEmployeeService(repo).remove(1)).rejects.toMatchObject({ code: 'EMPLOYEE_ATTENDANCE_UNAVAILABLE' });
  });

  it('fails closed when attendance state is unavailable for deactivation', async () => {
    const repo = repository();
    const service = createEmployeeService(repo, undefined, undefined, {
      prepareEmployeeDeletion: vi.fn(async () => undefined),
      previewEmployeeDeactivation: vi.fn(async () => ({
        unpaidInstallmentCount: 0, unpaidAdvanceAmount: '0.00', currentNetSalary: '0.00',
        projectedNetSalary: '0.00', amountOwed: '0.00', canZeroSalary: false,
      })),
    });

    await expect(service.previewDeactivation(1)).rejects.toMatchObject({ code: 'EMPLOYEE_ATTENDANCE_UNAVAILABLE' });
    await expect(service.deactivate(1, {
      reason: 'استقالة',
      lastWorkingDay: '2026-08-19',
      advanceDecision: 'sum_all',
      expectedUnpaidInstallmentCount: 0,
      expectedUnpaidAdvanceAmount: '0.00',
      expectedProjectedNetSalary: '0.00',
      expectedAmountOwed: '0.00',
    })).rejects.toMatchObject({ code: 'EMPLOYEE_ATTENDANCE_UNAVAILABLE' });
    expect(repo.previewDeactivation).not.toHaveBeenCalled();
    expect(repo.deactivate).not.toHaveBeenCalled();
  });

  it('checks attendance and soft deletes through one atomic repository operation', async () => {
    const repo = repository();
    const attendance = { hasOpenSession: vi.fn(async () => false), hasAnyOpenSession: vi.fn(async () => false) };
    vi.mocked(repo.softDeleteIfAttendanceClosed).mockResolvedValue('deleted');

    await createEmployeeService(repo, attendance).remove(1);

    expect(repo.softDeleteIfAttendanceClosed).toHaveBeenCalledWith(1, true, expect.any(Function));
    const atomicAttendanceCheck = vi.mocked(repo.softDeleteIfAttendanceClosed).mock.calls[0]![2];
    const context = { transaction: true };
    await atomicAttendanceCheck(1, context);
    expect(attendance.hasOpenSession).toHaveBeenCalledWith(1, context);
    expect(repo.findActiveById).not.toHaveBeenCalled();
  });

  it('runs advance acceleration inside the atomic employee deletion transaction', async () => {
    const repo = repository();
    const attendance = { hasOpenSession: vi.fn(async () => false), hasAnyOpenSession: vi.fn(async () => false) };
    const financialLifecycle = { prepareEmployeeDeletion: vi.fn(async () => undefined) };
    vi.mocked(repo.softDeleteIfAttendanceClosed).mockResolvedValue('deleted');

    await createEmployeeService(repo, attendance, undefined, financialLifecycle).remove(1);

    expect(repo.softDeleteIfAttendanceClosed).toHaveBeenCalledWith(
      1, true, expect.any(Function), undefined, expect.any(Function),
    );
    const prepareDeletion = vi.mocked(repo.softDeleteIfAttendanceClosed).mock.calls[0]![4]!;
    const context = { transaction: true };
    const deletedAt = new Date('2026-07-31T21:00:00.000Z');
    await prepareDeletion(1, deletedAt, context);
    expect(financialLifecycle.prepareEmployeeDeletion).toHaveBeenCalledWith(1, deletedAt, context);
  });

  it('returns the financial impact before deactivation without changing employee state', async () => {
    const repo = repository();
    vi.mocked(repo.previewDeactivation).mockResolvedValue({ kind: 'success' });
    const financialLifecycle = {
      prepareEmployeeDeletion: vi.fn(async () => undefined),
      previewEmployeeDeactivation: vi.fn(async () => ({
        unpaidInstallmentCount: 3,
        unpaidAdvanceAmount: '1500.00',
        currentNetSalary: '2000.00',
        projectedNetSalary: '-500.00',
        amountOwed: '500.00',
        canZeroSalary: true,
      })),
    };

    const result = await createEmployeeService(repo, closedAttendance(), undefined, financialLifecycle)
      .previewDeactivation(1);

    expect(result).toMatchObject({
      unpaidInstallmentCount: 3,
      unpaidAdvanceAmount: '1500.00',
      amountOwed: '500.00',
    });
    expect(repo.deactivate).not.toHaveBeenCalled();
  });

  it('flags an open session in the preview so the admin is warned before confirming', async () => {
    const repo = repository();
    vi.mocked(repo.previewDeactivation).mockResolvedValue({ kind: 'success' });
    const attendance = {
      hasOpenSession: vi.fn(async () => true),
      hasAnyOpenSession: vi.fn(async () => true),
    };
    const financialLifecycle = {
      prepareEmployeeDeletion: vi.fn(async () => undefined),
      previewEmployeeDeactivation: vi.fn(async () => ({
        unpaidInstallmentCount: 0,
        unpaidAdvanceAmount: '0.00',
        currentNetSalary: '2000.00',
        projectedNetSalary: '2000.00',
        amountOwed: '0.00',
        canZeroSalary: false,
      })),
    };

    await expect(createEmployeeService(repo, attendance, undefined, financialLifecycle)
      .previewDeactivation(1)).resolves.toMatchObject({ hasOpenSession: true });
  });

  it('reports financials unavailable rather than inventing a zeroed preview', async () => {
    const repo = repository();
    vi.mocked(repo.previewDeactivation).mockResolvedValue({ kind: 'success' });

    await expect(createEmployeeService(repo, closedAttendance()).previewDeactivation(1))
      .rejects.toMatchObject({ code: 'EMPLOYEE_FINANCIALS_UNAVAILABLE' });
  });

  it.each([
    ['not_found', 'EMPLOYEE_NOT_FOUND'],
    ['already_inactive', 'EMPLOYEE_ALREADY_INACTIVE'],
  ] as const)('rejects a %s preview before consulting financials', async (kind, code) => {
    const repo = repository();
    vi.mocked(repo.previewDeactivation).mockResolvedValue({ kind });
    const previewEmployeeDeactivation = vi.fn();
    const financialLifecycle = {
      prepareEmployeeDeletion: vi.fn(async () => undefined),
      previewEmployeeDeactivation,
    };

    await expect(createEmployeeService(repo, closedAttendance(), undefined, financialLifecycle)
      .previewDeactivation(1)).rejects.toMatchObject({ code });
    expect(previewEmployeeDeactivation).not.toHaveBeenCalled();
  });

  it('deactivates with explicit advance and negative-balance decisions', async () => {
    const repo = repository();
    vi.mocked(repo.deactivate).mockResolvedValue({
      kind: 'success',
      record: { id: 1, employmentStatus: 'inactive' } as never,
    });

    const employee = await createEmployeeService(repo, closedAttendance()).deactivate(1, {
      reason: 'استقالة',
      lastWorkingDay: '2026-08-19',
      advanceDecision: 'sum_all' as const,
      negativeBalanceDecision: 'record_debt',
      expectedUnpaidInstallmentCount: 3,
      expectedUnpaidAdvanceAmount: '1500.00',
      expectedProjectedNetSalary: '-500.00',
      expectedAmountOwed: '500.00',
    });

    expect(repo.deactivate).toHaveBeenCalledWith(1, {
      reason: 'استقالة',
      lastWorkingDay: '2026-08-19',
      advanceDecision: 'sum_all',
      negativeBalanceDecision: 'record_debt',
      expected: {
        unpaidInstallmentCount: 3,
        unpaidAdvanceAmount: '1500.00',
        projectedNetSalary: '-500.00',
        amountOwed: '500.00',
      },
    }, undefined, expect.any(Function));
    expect(employee.employee.employmentStatus).toBe('inactive');
    expect(employee.pendingUntilCheckOut).toBe(false);
  });

  it('passes the selected negative-balance decision into the atomic financial lifecycle', async () => {
    const repo = repository();
    const prepareEmployeeDeactivation = vi.fn(async () => settlementFigures);
    vi.mocked(repo.deactivate).mockImplementation(async (id, input, prepare) => {
      await prepare?.(id, new Date('2026-07-16T10:00:00.000Z'), input, { tx: true });
      return { kind: 'success', record: { id, employmentStatus: 'inactive' } as never };
    });
    const lifecycle = {
      prepareEmployeeDeletion: vi.fn(async () => undefined),
      prepareEmployeeDeactivation,
    };

    const input = {
      reason: 'استقالة',
      lastWorkingDay: '2026-08-19',
      advanceDecision: 'sum_all' as const,
      negativeBalanceDecision: 'collect_cash' as const,
      expectedUnpaidInstallmentCount: 3,
      expectedUnpaidAdvanceAmount: '1500.00',
      expectedProjectedNetSalary: '-500.00',
      expectedAmountOwed: '500.00',
    };
    await createEmployeeService(repo, closedAttendance(), undefined, lifecycle).deactivate(1, input);

    expect(prepareEmployeeDeactivation).toHaveBeenCalledWith(
      1,
      new Date('2026-07-16T10:00:00.000Z'),
      {
        reason: 'استقالة',
        lastWorkingDay: '2026-08-19',
        advanceDecision: 'sum_all',
        negativeBalanceDecision: 'collect_cash',
        expected: {
          unpaidInstallmentCount: 3,
          unpaidAdvanceAmount: '1500.00',
          projectedNetSalary: '-500.00',
          amountOwed: '500.00',
        },
      },
      { tx: true },
    );
  });

  it('schedules the deactivation instead of applying it while the employee is checked in', async () => {
    const repo = repository();
    const attendance = {
      hasOpenSession: vi.fn(async () => true),
      hasAnyOpenSession: vi.fn(async () => true),
    };
    vi.mocked(repo.deactivate).mockResolvedValue({
      kind: 'pending',
      record: { id: 1, employmentStatus: 'active' } as never,
    });

    const result = await createEmployeeService(repo, attendance).deactivate(1, {
      reason: 'استقالة',
      lastWorkingDay: '2026-08-19',
      advanceDecision: 'sum_all' as const,
      negativeBalanceDecision: 'record_debt' as const,
      expectedUnpaidInstallmentCount: 0,
      expectedUnpaidAdvanceAmount: '0.00',
      expectedProjectedNetSalary: '0.00',
      expectedAmountOwed: '0.00',
    });

    // He keeps working until check-out, so the employee is deliberately still active here.
    expect(result.pendingUntilCheckOut).toBe(true);
    expect(result.employee.employmentStatus).toBe('active');
  });

  it('reactivates while preserving employee schedule and configuration fields', async () => {
    const repo = repository();
    const existingRecord = {
      id: 1,
      employeeCode: 1001,
      credentialVersion: 7,
      employmentStatus: 'active' as const,
      fullName: 'أحمد',
      personalPhone: '01012345678',
      whatsappPhone: '01112345678',
      age: 30,
      address: 'القاهرة',
      branchId: 3,
      shiftDurationMinutes: 480,
      monthlyBaseSalary: '6500.00',
      images: input.images,
      pinHash: 'stored-hash',
      deletedAt: null,
      createdAt: new Date('2026-07-01T08:00:00.000Z'),
      updatedAt: new Date('2026-07-24T08:00:00.000Z'),
    };
    vi.mocked(repo.activate).mockResolvedValue({
      kind: 'success',
      record: existingRecord,
    });

    const employee = await createEmployeeService(repo).activate(1);

    expect(repo.activate).toHaveBeenCalledWith(1);
    expect(employee.employmentStatus).toBe('active');
    expect(employee).toMatchObject({
      branchId: existingRecord.branchId,
      shiftDurationMinutes: existingRecord.shiftDurationMinutes,
      images: existingRecord.images,
    });
  });

  describe('outstanding debts', () => {
    const debt = {
      id: 7,
      payrollMonth: '2026-08-01',
      amount: '450.00',
      createdAt: new Date('2026-08-01T08:00:00.000Z'),
      settledAt: null,
    };

    it('lists the debts recorded against an employee', async () => {
      const repo = repository();
      vi.mocked(repo.findActiveById).mockResolvedValue({ id: 1 } as never);
      vi.mocked(repo.listDebts).mockResolvedValue([debt]);

      await expect(createEmployeeService(repo).listDebts(1)).resolves.toEqual([debt]);
      expect(repo.listDebts).toHaveBeenCalledWith(1);
    });

    it('refuses to list the debts of an employee who does not exist', async () => {
      const repo = repository();
      vi.mocked(repo.findActiveById).mockResolvedValue(null);

      await expect(createEmployeeService(repo).listDebts(1))
        .rejects.toMatchObject({ code: 'EMPLOYEE_NOT_FOUND' });
      expect(repo.listDebts).not.toHaveBeenCalled();
    });

    it('marks a debt as paid', async () => {
      const repo = repository();
      const settled = { ...debt, settledAt: new Date('2026-08-20T09:00:00.000Z') };
      vi.mocked(repo.settleDebt).mockResolvedValue({ kind: 'success', debt: settled });

      await expect(createEmployeeService(repo).settleDebt(1, 7)).resolves.toEqual(settled);
      expect(repo.settleDebt).toHaveBeenCalledWith(1, 7);
    });

    it('reports a debt that is not there', async () => {
      const repo = repository();
      vi.mocked(repo.settleDebt).mockResolvedValue({ kind: 'not_found' });

      await expect(createEmployeeService(repo).settleDebt(1, 7))
        .rejects.toMatchObject({ code: 'EMPLOYEE_DEBT_NOT_FOUND' });
    });

    it('refuses to settle the same debt twice', async () => {
      const repo = repository();
      vi.mocked(repo.settleDebt).mockResolvedValue({ kind: 'already_settled' });

      await expect(createEmployeeService(repo).settleDebt(1, 7))
        .rejects.toMatchObject({ code: 'EMPLOYEE_DEBT_ALREADY_SETTLED' });
    });
  });

  describe('settlement statement', () => {
    const termination = {
      reason: 'استقالة',
      lastWorkingDay: '2026-08-19',
      terminatedAt: new Date('2026-08-19T18:00:00.000Z'),
      netSalaryBeforeSettlement: '1500.00',
      advancesRecovered: '3000.00',
      writeOffAmount: '0.00',
      forfeitedSalaryAmount: '0.00',
      cashCollectedAmount: '0.00',
      debtRecordedAmount: '1000.00',
      finalNetSalary: '-1000.00',
    };

    it('returns the frozen figures alongside who they belong to', async () => {
      const repo = repository();
      vi.mocked(repo.findActiveById).mockResolvedValue({ id: 4, employeeCode: 12, fullName: 'أحمد' } as never);
      vi.mocked(repo.findLatestTermination).mockResolvedValue(termination);

      await expect(createEmployeeService(repo).getSettlementStatement(4)).resolves.toEqual({
        employee: { id: 4, employeeCode: 12, fullName: 'أحمد' },
        ...termination,
      });
    });

    it('refuses a statement for an employee who never left', async () => {
      const repo = repository();
      vi.mocked(repo.findActiveById).mockResolvedValue({ id: 4, employeeCode: 12, fullName: 'أحمد' } as never);
      vi.mocked(repo.findLatestTermination).mockResolvedValue(null);

      await expect(createEmployeeService(repo).getSettlementStatement(4))
        .rejects.toMatchObject({ code: 'EMPLOYEE_NOT_TERMINATED' });
    });
  });

  describe('open work blocking deactivation', () => {
    const leaving = {
      reason: 'استقالة', lastWorkingDay: '2026-08-19', advanceDecision: 'sum_all' as const,
      negativeBalanceDecision: 'record_debt' as const,
      expectedUnpaidInstallmentCount: 0, expectedUnpaidAdvanceAmount: '0.00',
      expectedProjectedNetSalary: '0.00', expectedAmountOwed: '0.00',
    };

    it('refuses to deactivate an employee who still has work assigned to them', async () => {
      const repo = repository();
      const openWork = { countOpenWork: vi.fn(async () => ({ futureBookings: 2, openQueueTickets: 1 })) };

      await expect(createEmployeeService(repo, closedAttendance(), undefined, undefined, openWork)
        .deactivate(1, leaving))
        .rejects.toMatchObject({ code: 'EMPLOYEE_HAS_OPEN_WORK' });
      expect(openWork.countOpenWork).toHaveBeenCalledWith(1);
      expect(repo.deactivate).not.toHaveBeenCalled();
    });

    it('proceeds once nothing is assigned to them any more', async () => {
      const repo = repository();
      vi.mocked(repo.deactivate).mockResolvedValue({ kind: 'success', record: { id: 1, employmentStatus: 'inactive' } as never });
      const openWork = { countOpenWork: vi.fn(async () => ({ futureBookings: 0, openQueueTickets: 0 })) };

      await createEmployeeService(repo, closedAttendance(), undefined, undefined, openWork).deactivate(1, leaving);

      expect(repo.deactivate).toHaveBeenCalled();
    });

    it('deactivates normally in an edition that has no bookings or queue at all', async () => {
      const repo = repository();
      vi.mocked(repo.deactivate).mockResolvedValue({ kind: 'success', record: { id: 1, employmentStatus: 'inactive' } as never });

      await createEmployeeService(repo, closedAttendance()).deactivate(1, leaving);

      expect(repo.deactivate).toHaveBeenCalled();
    });
  });
});
