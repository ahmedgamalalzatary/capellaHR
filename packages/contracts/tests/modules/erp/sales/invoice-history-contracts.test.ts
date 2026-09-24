import { describe, expect, it } from 'vitest';

import {
  branchCashierRosterItemSchema,
  branchCashierRosterQuerySchema,
  clientVisitHistoryQuerySchema,
  clientVisitSummarySchema,
  invoiceHistoryItemSchema,
  invoiceHistoryQuerySchema,
  invoiceParamsSchema,
  replaceBranchCashierRosterSchema,
} from '../../../../src/modules/erp/sales/index.js';

describe('ERP complete-sale contracts', () => {
  it('validates branch cashier roster reads and full replacements', () => {
    expect(branchCashierRosterQuerySchema.parse({ branchId: '2' })).toEqual({ branchId: 2 });
    expect(branchCashierRosterQuerySchema.parse({})).toEqual({});
    const member = { id: 8, employeeCode: 1008, fullName: 'سارة علي' };
    expect(branchCashierRosterItemSchema.parse(member)).toEqual(member);
    expect(replaceBranchCashierRosterSchema.parse({ employeeIds: [8, 9] }))
      .toEqual({ employeeIds: [8, 9] });
    expect(replaceBranchCashierRosterSchema.parse({ employeeIds: [] })).toEqual({ employeeIds: [] });
    expect(replaceBranchCashierRosterSchema.safeParse({ employeeIds: [8, 8] }).success).toBe(false);
  });

  it('publishes paged client visit-history summaries', () => {
    expect(clientVisitHistoryQuerySchema.parse({ page: '2', pageSize: '10', branchId: '3' }))
      .toEqual({ page: 2, pageSize: 10, branchId: 3 });
    expect(clientVisitSummarySchema.safeParse({
      id: 44,
      invoiceNumber: 'INV-2026.08.03-14.35-17',
      status: 'completed',
      total: '185.00',
      employees: [{ id: 8, name: 'سارة علي' }, { id: 11, name: 'هدى محمود' }],
      soldAt: '2026-08-03T11:35:00.000Z',
    }).success).toBe(true);
    expect(clientVisitSummarySchema.safeParse({
      id: 44,
      invoiceNumber: 'INV-2026.08.03-14.35-17',
      status: 'completed',
      total: '185.00',
      employees: [{ id: 8, name: 'سارة علي' }, { id: 8, name: 'سارة علي' }],
      soldAt: '2026-08-03T11:35:00.000Z',
    }).success).toBe(false);
    expect(clientVisitSummarySchema.safeParse({
      id: 45,
      invoiceNumber: 'INV-2026.08.03-14.35-18',
      status: 'completed',
      total: '0.00',
      employees: [{ id: 8, name: 'سارة علي' }],
      soldAt: '2026-08-03T11:36:00.000Z',
    }).success).toBe(true);
  });

  it('publishes branch-scoped paged invoice history and detail parameters', () => {
    expect(invoiceHistoryQuerySchema.parse({
      page: '2', pageSize: '10', branchId: '3', clientId: '42', search: '  01012345678  ',
    })).toEqual({
      page: 2, pageSize: 10, branchId: 3, clientId: 42, search: '01012345678',
      orderBy: 'soldAt', orderDir: 'desc',
    });
    expect(invoiceParamsSchema.parse({ invoiceId: '44' })).toEqual({ invoiceId: 44 });
    expect(invoiceParamsSchema.safeParse({ invoiceId: '0' }).success).toBe(false);
  });

  it('filters invoice history by status, settlement, dates, and employee with sortable columns', () => {
    expect(invoiceHistoryQuerySchema.parse({
      status: 'completed', settlementStatus: 'open',
      fromDate: '2026-08-01', toDate: '2026-08-31', employeeId: '8',
      orderBy: 'total', orderDir: 'asc',
    })).toEqual({
      page: 1, pageSize: 20,
      status: 'completed', settlementStatus: 'open',
      fromDate: '2026-08-01', toDate: '2026-08-31', employeeId: 8,
      orderBy: 'total', orderDir: 'asc',
    });
    expect(invoiceHistoryQuerySchema.safeParse({ status: 'draft' }).success).toBe(false);
    expect(invoiceHistoryQuerySchema.safeParse({ settlementStatus: 'paid' }).success).toBe(false);
    expect(invoiceHistoryQuerySchema.safeParse({ fromDate: '2026-09-01', toDate: '2026-08-01' }).success).toBe(false);
    expect(invoiceHistoryQuerySchema.safeParse({ fromDate: 'not-a-date' }).success).toBe(false);
    expect(invoiceHistoryQuerySchema.safeParse({ orderBy: 'client' }).success).toBe(false);
    expect(invoiceHistoryQuerySchema.safeParse({ orderDir: 'sideways' }).success).toBe(false);
  });

  it('publishes receipt-safe stored invoice history summaries', () => {
    expect(invoiceHistoryItemSchema.safeParse({
      id: 44,
      invoiceNumber: 'INV-2026.08.03-14.35-17',
      status: 'completed',
      total: '185.00',
      amountPaid: '185.00', balanceDue: '0.00', settlementStatus: 'settled',
      client: { id: 5, name: 'منى أحمد', phone: '01012345678' },
      employees: [{ id: 8, name: 'سارة علي' }, { id: 11, name: 'هدى محمود' }],
      soldAt: '2026-08-03T11:35:00.000Z',
    }).success).toBe(true);
    expect(invoiceHistoryItemSchema.safeParse({
      id: 45,
      invoiceNumber: 'INV-2026.08.03-14.35-18',
      status: 'completed',
      total: '0.00',
      amountPaid: '0.00', balanceDue: '0.00', settlementStatus: 'settled',
      client: { id: 5, name: 'منى أحمد', phone: '01012345678' },
      employees: [{ id: 8, name: 'سارة علي' }],
      soldAt: '2026-08-03T11:36:00.000Z',
    }).success).toBe(true);
  });

  it('keeps a phone-only client identifiable in the stored history summary', () => {
    const parsed = invoiceHistoryItemSchema.safeParse({
      id: 44,
      invoiceNumber: 'INV-2026.08.03-14.35-17',
      status: 'completed',
      total: '185.00',
      amountPaid: '185.00', balanceDue: '0.00', settlementStatus: 'settled',
      client: { id: 5, name: null, phone: '01012345678' },
      employees: [],
      soldAt: '2026-08-03T11:35:00.000Z',
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.client.phone).toBe('01012345678');
  });
});
