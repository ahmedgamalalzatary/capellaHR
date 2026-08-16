import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import {
  createCommissionRouter,
  createCommissionService,
} from '../../src/modules/erp/commissions/index.js';

const summary = {
  employeeId: 7, employeeCode: 1007, employeeName: 'Sara', payrollMonth: '2026-08',
  earnedAmount: '30.00', reversedAmount: '10.00', netAmount: '20.00',
  invoiceLineCount: 1, reversalCount: 1,
};
const service = createCommissionService({
  repository: {
    list: async () => ({ items: [summary], total: 1 }),
    detail: async () => ({ summary, entries: [] }),
    summary: async () => summary,
  },
  resolveBranchContext: async (_actor, branchId) => ({
    branchId: branchId ?? 4, accountId: 1, accountRole: 'admin', employeeId: null,
  }),
});
const appFor = (actor: unknown) => {
  const app = express();
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
    expect(detail.body).toEqual({ data: { summary, entries: [] } });
  });

  it('rejects cashier access and invalid months', async () => {
    const cashier = appFor({ type: 'cashier', accountId: 2, branchId: 1 });
    expect((await request(cashier).get('/commissions?month=2026-08')).status).toBe(403);
    expect((await request(appFor({ type: 'admin', accountId: 1 }))
      .get('/commissions?month=bad')).status).toBe(400);
  });
});
