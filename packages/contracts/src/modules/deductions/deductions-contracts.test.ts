import { describe, expect, it } from 'vitest';

import {
  createDeductionSchema,
  deductionParamsSchema,
  listDeductionsQuerySchema,
  updateDeductionSchema,
} from './index.js';

describe('deduction contracts', () => {
  it('mirrors positive fixed payroll adjustments without employee reassignment', () => {
    expect(createDeductionSchema.parse({ employeeId: 4, amount: '10.1', payrollMonth: '2026-07' }))
      .toEqual({ employeeId: 4, amount: '10.10', payrollMonth: '2026-07' });
    expect(updateDeductionSchema.parse({ payrollMonth: '2026-06' }))
      .toEqual({ payrollMonth: '2026-06' });
    expect(deductionParamsSchema.parse({ deductionId: '8' })).toEqual({ deductionId: 8 });
    expect(listDeductionsQuerySchema.parse({ payrollMonth: '2026-07' }))
      .toEqual({ payrollMonth: '2026-07', page: 1, pageSize: 20 });
    expect(() => updateDeductionSchema.parse({ employeeId: 9 })).toThrow();
  });
});
