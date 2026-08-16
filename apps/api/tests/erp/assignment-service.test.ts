import { describe, expect, it, vi } from 'vitest';

import {
  createErpBranchContextResolver,
  type ErpBranchCapability,
} from '../../src/modules/erp/index.js';
import {
  createEmployeeAssignmentService,
  type ErpAssignmentError,
} from '../../src/modules/erp/assignment/index.js';

const nada = { id: 7, employeeCode: 42, fullName: 'ندى سمير', branchId: 1 };

// Branch 1 belongs to the cashier's employee; branch 2 exists but is not theirs.
const branches = {
  findById: vi.fn(async (id: number) => (id === 1 || id === 2 ? { id, name: `فرع ${id}` } : null)),
} as unknown as ErpBranchCapability;

const ADMIN = { role: 'admin' as const, accountId: 1 };
const CASHIER = { role: 'cashier' as const, accountId: 2, branchId: 1 };

const service = (attendance: {
  listPresentEmployees?: (branchId: number) => Promise<typeof nada[]>;
  findPresentEmployee?: (
    branchId: number, employeeId: number, context?: unknown,
  ) => Promise<typeof nada | null>;
} = {}) => createEmployeeAssignmentService({
  attendance: {
    listPresentEmployees: attendance.listPresentEmployees ?? (async () => [nada]),
    findPresentEmployee: attendance.findPresentEmployee ?? (async () => nada),
  },
  resolveBranchContext: createErpBranchContextResolver({ branches }),
});

const code = async (run: Promise<unknown>) => {
  try {
    await run;
    return 'no-error';
  } catch (error) {
    return (error as ErpAssignmentError).code;
  }
};

describe('ERP employee assignment eligibility', () => {
  it('lists the employees present in the cashier own branch', async () => {
    const listPresentEmployees = vi.fn(async () => [nada]);

    await expect(service({ listPresentEmployees }).listAssignable(CASHIER, {}))
      .resolves.toEqual([nada]);
    expect(listPresentEmployees).toHaveBeenCalledWith(1);
  });

  it('requires an admin to name the branch they act on', async () => {
    expect(await code(service().listAssignable(ADMIN, {}))).toBe('ERP_BRANCH_REQUIRED');
  });

  it('refuses to list another branch for a cashier', async () => {
    expect(await code(service().listAssignable(CASHIER, { branchId: 2 })))
      .toBe('ERP_BRANCH_FORBIDDEN');
  });

  it('confirms an employee who is still checked in at the acting branch', async () => {
    await expect(service().assertAssignable(CASHIER, { employeeId: 7 })).resolves.toEqual(nada);
  });

  it('rejects an employee who is not checked in', async () => {
    const absent = service({ findPresentEmployee: async () => null });

    expect(await code(absent.assertAssignable(CASHIER, { employeeId: 7 })))
      .toBe('ERP_EMPLOYEE_NOT_PRESENT');
  });

  /** The select-then-checkout race: present at selection, gone at completion. */
  it('rejects an employee who checked out after being selected', async () => {
    let present = true;
    const assignment = service({
      findPresentEmployee: async () => (present ? nada : null),
    });

    expect(await assignment.assertAssignable(CASHIER, { employeeId: 7 })).toEqual(nada);
    present = false;

    expect(await code(assignment.assertAssignable(CASHIER, { employeeId: 7 })))
      .toBe('ERP_EMPLOYEE_NOT_PRESENT');
  });

  it('gives an admin no override for an employee who never checked in', async () => {
    const absent = service({ findPresentEmployee: async () => null });

    expect(await code(absent.assertAssignable(ADMIN, { employeeId: 7, branchId: 1 })))
      .toBe('ERP_EMPLOYEE_NOT_PRESENT');
  });

  it('never accepts an employee present only in another branch', async () => {
    const findPresentEmployee = vi.fn(async () => null);
    const absent = service({ findPresentEmployee });

    expect(await code(absent.assertAssignable(CASHIER, { employeeId: 7 })))
      .toBe('ERP_EMPLOYEE_NOT_PRESENT');
    // The acting branch, never the requested employee, scopes the lookup.
    expect(findPresentEmployee).toHaveBeenCalledWith(1, 7, undefined);
  });

  it('re-checks presence inside the caller transaction that completes the sale', async () => {
    const findPresentEmployee = vi.fn(async () => nada);
    const transaction = Symbol('sale transaction');

    await service({ findPresentEmployee })
      .assertAssignable(CASHIER, { employeeId: 7 }, transaction);

    expect(findPresentEmployee).toHaveBeenCalledWith(1, 7, transaction);
  });
});
