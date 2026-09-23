import { describe, expect, it } from 'vitest';

import {
  commissionEntrySchema,
  commissionDetailSchema,
  commissionListQuerySchema,
  commissionMonthParamsSchema,
  commissionPayoutCreateSchema,
  commissionPayoutSchema,
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
      paidAmount: '0.00', availableAmount: '250.00',
      invoiceLineCount: 3, reversalCount: 1,
    })).toMatchObject({ netAmount: '250.00' });
    expect(commissionDetailSchema.parse({
      summary: {
        employeeId: 7, employeeCode: 1007, employeeName: 'Sara', payrollMonth: '2026-08',
        earnedAmount: '300.00', reversedAmount: '50.00', netAmount: '250.00',
        paidAmount: '0.00', availableAmount: '250.00',
        invoiceLineCount: 3, reversalCount: 1,
      },
      entries: [{
        id: 11, type: 'reassignment_out', invoiceId: 21, invoiceNumber: 'INV-2026.08.03-14.35-17',
        invoiceLineId: 31, lineNumber: 1, serviceName: 'Hair', baseAmount: '100.00',
        commissionRate: '10.00', amount: '-10.00', reversalId: null, reassignmentId: 51,
        occurredAt: '2026-09-01T09:00:00.000Z',
      }],
      payouts: [],
    }).entries[0]).toMatchObject({ reassignmentId: 51, amount: '-10.00' });
  });

  it('rejects money outside the DECIMAL(14,2) database range', () => {
    expect(commissionSummarySchema.safeParse({
      employeeId: 7, employeeCode: 1007, employeeName: 'Sara', payrollMonth: '2026-08',
      earnedAmount: '1000000000000.00', reversedAmount: '0.00', netAmount: '1000000000000.00',
      paidAmount: '0.00', availableAmount: '1000000000000.00',
      invoiceLineCount: 1, reversalCount: 0,
    }).success).toBe(false);
  });

  it('accepts numeric invoice numbers in commission entries', () => {
    expect(commissionEntrySchema.safeParse({
      id: 11, type: 'earned', invoiceId: 21, invoiceNumber: '000001',
      invoiceLineId: 31, lineNumber: 1, serviceName: 'Hair', baseAmount: '100.00',
      commissionRate: '10.00', amount: '10.00', reversalId: null, reassignmentId: null,
      occurredAt: '2026-09-01T09:00:00.000Z',
    }).success).toBe(true);
  });

  it('parses a positive partial commission payout request', () => {
    expect(commissionPayoutCreateSchema.parse({
      amount: '200.00', branchId: '4', reason: 'دفع جزئي',
    })).toEqual({ amount: '200.00', branchId: 4, reason: 'دفع جزئي' });
    expect(commissionPayoutCreateSchema.parse({ amount: '200.00' }))
      .toEqual({ amount: '200.00' });
    expect(commissionPayoutCreateSchema.safeParse({ amount: '0.00' }).success).toBe(false);
    expect(commissionPayoutCreateSchema.safeParse({ amount: '00.00' }).success).toBe(false);
    expect(commissionPayoutCreateSchema.safeParse({ amount: '0000000000.00' }).success).toBe(false);
    expect(commissionPayoutCreateSchema.safeParse({ amount: '00.01' }).success).toBe(true);
    expect(commissionPayoutCreateSchema.safeParse({ amount: '-5.00' }).success).toBe(false);
    expect(commissionPayoutCreateSchema.safeParse({ amount: '200' }).success).toBe(false);
    expect(commissionPayoutCreateSchema.safeParse({ amount: '10000000000.00' }).success).toBe(false);
    expect(commissionPayoutCreateSchema.safeParse({ amount: '200.00', reason: '   ' }).success)
      .toBe(false);
  });

  it('publishes paid and available balances on the monthly summary', () => {
    expect(commissionSummarySchema.parse({
      employeeId: 7, employeeCode: 1007, employeeName: 'Sara', payrollMonth: '2026-08',
      earnedAmount: '300.00', reversedAmount: '50.00', netAmount: '250.00',
      paidAmount: '100.00', availableAmount: '150.00',
      invoiceLineCount: 3, reversalCount: 1,
    })).toMatchObject({ paidAmount: '100.00', availableAmount: '150.00' });
  });

  it('records a payout with its linked expense', () => {
    expect(commissionPayoutSchema.parse({
      id: 1, employeeId: 7, payrollMonth: '2026-08', branchId: 4, amount: '200.00',
      expenseId: 9, reason: null, createdAt: '2026-08-10T10:00:00.000Z',
    })).toMatchObject({ amount: '200.00', expenseId: 9 });
    expect(commissionPayoutSchema.safeParse({
      id: 1, employeeId: 7, payrollMonth: '2026-08', branchId: 4, amount: '0.00',
      expenseId: 9, reason: null, createdAt: '2026-08-10T10:00:00.000Z',
    }).success).toBe(false);
  });
});
