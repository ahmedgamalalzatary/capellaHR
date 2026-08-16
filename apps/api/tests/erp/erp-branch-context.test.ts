import { describe, expect, it, vi } from 'vitest';

import {
  createErpBranchContextResolver,
  ErpBranchContextError,
} from '../../src/modules/erp/index.js';

const setup = (options: {
  branchExists?: boolean;
  employee?: {
    id: number;
    employeeCode: number;
    fullName: string;
    branchId: number;
  } | null;
} = {}) => {
  const branches = {
    findById: vi.fn(async (id: number) => (
      options.branchExists === false ? null : { id, name: `Branch ${id}` }
    )),
  };
  const employees = {
    findActiveById: vi.fn(async () => (
      options.employee === undefined
        ? { id: 7, employeeCode: 42, fullName: 'Employee', branchId: 3 }
        : options.employee
    )),
  };
  return {
    branches,
    employees,
    resolve: createErpBranchContextResolver({ branches }),
  };
};

describe('ERP branch context', () => {
  it('validates and uses the branch selected by an Admin account', async () => {
    const { branches, employees, resolve } = setup();

    await expect(resolve({ role: 'admin', accountId: 1 }, 4)).resolves.toEqual({
      accountId: 1,
      accountRole: 'admin',
      branchId: 4,
      employeeId: null,
    });
    expect(branches.findById).toHaveBeenCalledWith(4);
    expect(employees.findActiveById).not.toHaveBeenCalled();
  });

  it('requires an Admin account to select a branch', async () => {
    const { resolve } = setup();

    await expect(resolve({ role: 'admin', accountId: 1 })).rejects.toMatchObject({
      code: 'ERP_BRANCH_REQUIRED',
      message: 'يجب اختيار الفرع',
    });
  });

  it('rejects an unknown Admin-selected branch', async () => {
    const { resolve } = setup({ branchExists: false });

    await expect(resolve({ role: 'admin', accountId: 1 }, 99)).rejects.toMatchObject({
      code: 'ERP_BRANCH_NOT_FOUND',
      message: 'الفرع غير موجود',
    });
  });

  it('derives a Cashier branch from the account identity itself', async () => {
    const { branches, employees, resolve } = setup();

    await expect(resolve({
      role: 'cashier',
      accountId: 8,
      branchId: 3,
    })).resolves.toEqual({
      accountId: 8,
      accountRole: 'cashier',
      branchId: 3,
      employeeId: null,
    });
    expect(employees.findActiveById).not.toHaveBeenCalled();
    expect(branches.findById).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied branch that differs from the Cashier branch', async () => {
    const { resolve } = setup();

    await expect(resolve({
      role: 'cashier',
      accountId: 8,
      branchId: 3,
    }, 4)).rejects.toMatchObject({
      code: 'ERP_BRANCH_FORBIDDEN',
      message: 'لا يمكن للكاشير تنفيذ عمليات على فرع آخر',
    });
  });

  it('fails closed when the Cashier account has no branch', async () => {
    const { resolve } = setup();

    await expect(resolve({ role: 'cashier', accountId: 8 } as never))
      .rejects.toBeInstanceOf(ErpBranchContextError);
    await expect(resolve({ role: 'cashier', accountId: 8 } as never))
      .rejects.toMatchObject({
        code: 'ERP_CASHIER_EMPLOYEE_UNAVAILABLE',
        message: 'حساب كاشير الفرع غير متاح',
      });
  });
});
