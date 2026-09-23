import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import {
  createCommissionRouter,
  createCommissionService,
} from '../../src/modules/erp/commissions/index.js';
import { createErpBranchContextResolver } from '../../src/modules/erp/branch-context.js';

const summary = {
  employeeId: 7, employeeCode: 1007, employeeName: 'Sara', payrollMonth: '2026-08',
  earnedAmount: '30.00', reversedAmount: '10.00', netAmount: '20.00',
  paidAmount: '5.00', availableAmount: '15.00',
  invoiceLineCount: 1, reversalCount: 1,
};
const payout = {
  id: 1, employeeId: 7, payrollMonth: '2026-08', branchId: 4, amount: '5.00',
  expenseId: 9, reason: null, createdAt: '2026-08-10T10:00:00.000Z',
};
const createPayout = vi.fn(async () => ({ kind: 'success' as const, payout, summary }));
const service = createCommissionService({
  repository: {
    list: async () => ({ items: [summary], total: 1 }),
    detail: async (_branchId, employeeId) => employeeId === 7
      ? { summary, entries: [], payouts: [] }
      : null,
    summary: async () => summary,
    createPayout,
  },
  resolveBranchContext: createErpBranchContextResolver({
    branches: { findById: async (id) => ({ id, name: 'Branch' }) },
  }),
});
const appFor = (actor: unknown) => {
  const app = express();
  app.use(express.json());
  app.use((_, response, next) => { response.locals.actor = actor; next(); });
  app.use('/commissions', createCommissionRouter(service));
  return app;
};

describe('ERP commission router', () => {
  it('returns paginated Admin totals and employee traceability', async () => {
    const app = appFor({ type: 'admin', accountId: 1 });
    const list = await request(app).get('/commissions?month=2026-08&branchId=4');
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ data: [summary], meta: { total: 1, page: 1 } });
    const detail = await request(app).get('/commissions/7/2026-08?branchId=4');
    expect(detail.status).toBe(200);
    expect(detail.body).toEqual({ data: { summary, entries: [], payouts: [] } });
  });

  it('allows a cashier to read only their branch and rejects invalid months', async () => {
    const cashier = appFor({ type: 'cashier', accountId: 2, branchId: 4 });
    expect((await request(cashier).get('/commissions?month=2026-08')).status).toBe(200);
    expect((await request(cashier).get('/commissions/7/2026-08')).status).toBe(200);
    expect((await request(cashier).get('/commissions?month=2026-08&branchId=5')).status).toBe(403);
    expect((await request(cashier).get('/commissions/7/2026-08?branchId=5')).status).toBe(403);
    expect((await request(appFor({ type: 'admin', accountId: 1 }))
      .get('/commissions?month=bad')).status).toBe(400);
  });

  it('records admin and cashier partial payouts and rejects invalid amounts or foreign branches', async () => {
    createPayout.mockClear();
    const admin = appFor({ type: 'admin', accountId: 1 });
    const created = await request(admin)
      .post('/commissions/7/2026-08/payouts')
      .send({ amount: '5.00', branchId: 4 });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ data: { payout, summary } });
    expect(createPayout).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: 7, month: '2026-08', amount: '5.00',
    }));

    const invalid = await request(admin)
      .post('/commissions/7/2026-08/payouts')
      .send({ amount: '0.00', branchId: 4 });
    expect(invalid.status).toBe(400);

    const cashier = appFor({ type: 'cashier', accountId: 2, branchId: 4 });
    expect((await request(cashier)
      .post('/commissions/7/2026-08/payouts')
      .send({ amount: '5.00' })).status).toBe(201);
    expect((await request(cashier)
      .post('/commissions/7/2026-08/payouts')
      .send({ amount: '5.00', branchId: 5 })).status).toBe(403);
    expect((await request(cashier)
      .post('/commissions/8/2026-08/payouts')
      .send({ amount: '5.00' })).status).toBe(404);
  });
});
