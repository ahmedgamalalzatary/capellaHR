import { describe, expect, it, vi } from 'vitest';

import { createErpAssignmentModule } from '../../src/modules/erp/index.js';

const nada = { id: 7, employeeCode: 42, fullName: 'ندى سمير', branchId: 1 };

describe('ERP assignment module', () => {
  it('wires the attendance capability and branch resolution into one service', async () => {
    const listPresentEmployees = vi.fn(async () => [nada]);
    const module = createErpAssignmentModule({
      attendance: { listPresentEmployees, findPresentEmployee: async () => nada },
      branches: { findById: async (id: number) => ({ id, name: `فرع ${id}` }) },
      employees: { findActiveById: async () => null },
    });

    await expect(module.service.listAssignable({ role: 'admin', accountId: 1 }, { branchId: 1 }))
      .resolves.toEqual([nada]);
    expect(listPresentEmployees).toHaveBeenCalledWith(1);
  });
});
