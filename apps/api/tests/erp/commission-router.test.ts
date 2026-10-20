import express from 'express';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import {
  createCommissionRouter,
  createCommissionService,
} from '../../src/modules/erp/commissions/index.js';
import { createErpBranchContextResolver } from '../../src/modules/erp/branch-context.js';
import { renderReportExcel } from '../../src/modules/reports/report-excel.js';

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
const appFor = (actor: unknown, commissionService = service) => {
  const app = express();
  app.use(express.json());
  app.use((_, response, next) => { response.locals.actor = actor; next(); });
  app.use('/commissions', createCommissionRouter(commissionService, renderReportExcel));
  return app;
};

const downloadExcel = (app: express.Express, query: string) => request(app)
  .get(`/commissions/excel?${query}`).buffer(true).parse((incoming, done) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => done(null, Buffer.concat(chunks)));
    incoming.on('error', done);
  });

describe('ERP commission router', () => {
  it.each([
    { type: 'admin', accountId: 1 },
    { type: 'cashier', accountId: 2, branchId: 4 },
  ])('downloads monthly table values as Excel for $type', async (actor) => {
    const response = await downloadExcel(appFor(actor), 'month=2026-08&branchId=4&employeeId=7');
    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain('commissions-2026-08.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.views[0]?.rightToLeft).toBe(true);
    expect(sheet.getRow(2).values).toEqual([
      undefined, 1007, 'Sara', '30.00', '10.00', '20.00', '5.00', '15.00', '1 / 1',
    ]);
  });

  it('exports all matching pages with the month, branch and employee filters', async () => {
    const list = vi.fn<typeof service.list>(async (_actor, query) => ({
      items: query.page === 1 ? Array.from({ length: 100 }, () => summary)
        : [{ ...summary, employeeName: 'Last employee' }],
      total: 101,
    }));
    const response = await downloadExcel(
      appFor({ type: 'admin', accountId: 1 }, { ...service, list }),
      'month=2026-08&branchId=4&employeeId=7',
    );
    expect(response.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body as ExcelJS.Buffer);
    expect(workbook.worksheets[0]!.rowCount).toBe(102);
    expect(workbook.worksheets[0]!.getRow(102).getCell(2).value).toBe('Last employee');
    expect(list.mock.calls.map(([, query]) => query)).toEqual([
      { month: '2026-08', branchId: 4, employeeId: 7, page: 1, pageSize: 100 },
      { month: '2026-08', branchId: 4, employeeId: 7, page: 2, pageSize: 100 },
    ]);
  });

  it('protects Excel downloads with commission branch permissions and query validation', async () => {
    for (const [actor, query, status] of [
      [{ type: 'cashier', accountId: 2, branchId: 4 }, 'month=2026-08&branchId=5', 403],
      [{ type: 'employee', employeeId: 7 }, 'month=2026-08', 403],
      [{ type: 'admin', accountId: 1 }, 'month=2026-08', 403],
      [{ type: 'admin', accountId: 1 }, 'month=bad&branchId=4', 400],
    ] as const) {
      expect((await request(appFor(actor)).get(`/commissions/excel?${query}`)).status).toBe(status);
    }
  });

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
