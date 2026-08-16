import { describe, expect, it } from 'vitest';

import {
  commissionDetailSchema,
  commissionListQuerySchema,
  commissionMonthParamsSchema,
  commissionSummarySchema,
} from '../../../../src/modules/erp/commissions/index.js';

describe('ERP commission contracts', () => {
  it('parses a bounded employee/month list query', () => {
    expect(commissionListQuerySchema.parse({
      month: '2026-08', branchId: '4', employeeId: '7', page: '2', pageSize: '10',
    })).toEqual({ month: '2026-08', branchId: 4, employeeId: 7, page: 2, pageSize: 10 });
    expect(commissionMonthParamsSchema.parse({ employeeId: '7', month: '2026-08' }))
      .toEqual({ employeeId: 7, month: '2026-08' });
    expect(commissionListQuerySchema.safeParse({ month: '2026-13' }).success).toBe(false);
  });

  it('publishes monthly totals and invoice-line reversal traceability', () => {
    expect(commissionSummarySchema.parse({
      employeeId: 7, employeeCode: 1007, employeeName: 'Sara', payrollMonth: '2026-08',
      earnedAmount: '300.00', reversedAmount: '50.00', netAmount: '250.00',
      invoiceLineCount: 3, reversalCount: 1,
    })).toMatchObject({ netAmount: '250.00' });
    expect(commissionDetailSchema.parse({
      summary: {
        employeeId: 7, employeeCode: 1007, employeeName: 'Sara', payrollMonth: '2026-08',
        earnedAmount: '300.00', reversedAmount: '50.00', netAmount: '250.00',
        invoiceLineCount: 3, reversalCount: 1,
      },
      entries: [{
        id: 11, type: 'reversal', invoiceId: 21, invoiceNumber: 'INV-2026.08.03-14.35-17',
        invoiceLineId: 31, lineNumber: 1, serviceName: 'Hair', baseAmount: '100.00',
        commissionRate: '10.00', amount: '-10.00', reversalId: 41,
        occurredAt: '2026-09-01T09:00:00.000Z',
      }],
    }).entries[0]).toMatchObject({ reversalId: 41, amount: '-10.00' });
  });

  it('rejects money outside the DECIMAL(14,2) database range', () => {
    expect(commissionSummarySchema.safeParse({
      employeeId: 7, employeeCode: 1007, employeeName: 'Sara', payrollMonth: '2026-08',
      earnedAmount: '1000000000000.00', reversedAmount: '0.00', netAmount: '1000000000000.00',
      invoiceLineCount: 1, reversalCount: 0,
    }).success).toBe(false);
  });
});
