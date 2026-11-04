import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApiRouter } from '../../src/routes/index.js';

type Call = { method: string; args: unknown[] };

/** A service double that answers every call with an empty page and records who asked. */
const stubService = (calls: Call[], overrides: Record<string, (...args: unknown[]) => unknown> = {}) => new Proxy({}, {
  get: (_target, method) => (method === 'then'
    ? undefined
    : async (...args: unknown[]) => {
        calls.push({ method: String(method), args });
        const override = overrides[String(method)];
        return override ? override(...args) : { items: [], total: 0 };
      }),
});

const openShift = {
  id: 9, branchId: 3, branchName: 'فرع مدينة نصر', openedByAccountId: 21,
  openedByUsername: 'cashier.one', openedAt: new Date('2026-11-02T08:00:00.000Z'),
  closedAt: null, closedByAccountId: null, closedByUsername: null, autoClosedAt: null,
};

const makeApp = (
  accountRole: 'cashier' | 'reception',
  options: { shiftOpen?: boolean } = {},
) => {
  const calls: Call[] = [];
  const shiftCalls: Call[] = [];
  const service = () => stubService(calls);
  const authService = {
    async authenticate(token: string) {
      return token === 'valid-token'
        ? {
            id: 'session', tokenHash: 'hash', actorType: 'account' as const,
            accountRole, accountId: 22, branchId: 3, employeeId: null,
            expiresAt: new Date('2030-01-01T00:00:00.000Z'), revokedAt: null,
          }
        : null;
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/v1', createApiRouter({
    authService: authService as never,
    cashierSessionService: stubService(shiftCalls, {
      current: () => ((options.shiftOpen ?? true) ? openShift : null),
    }) as never,
    erpBranchCashierRosterService: service() as never,
    erpSaleService: service() as never,
    erpClientService: service() as never,
    erpBookingService: service() as never,
    erpCategoryService: service() as never,
    erpServiceCatalogService: service() as never,
    erpProductStockService: service() as never,
    erpConsumablesService: service() as never,
    erpSupplierPurchaseService: service() as never,
    erpStockTransferService: service() as never,
    erpProductSyncService: service() as never,
    erpExpenseService: service() as never,
    erpFixedAssetService: service() as never,
    erpAssignmentService: service() as never,
    erpCommissionService: service() as never,
  }));
  return { app, calls, shiftCalls };
};

const cookie = 'capella_session=valid-token';

/** The six front-desk areas a reception login may look at. */
const readableAreas = [
  '/erp/sales',
  '/erp/bookings/exists',
  '/erp/clients',
  '/erp/categories',
  '/erp/services',
  '/erp/products',
  '/erp/consumables',
];

const closedAreas = [
  '/erp/commissions',
  '/erp/expenses',
  '/erp/stock-transfers',
  '/erp/cashier-sessions',
  '/erp/cashier-sessions/9',
  '/erp/cashier-sessions/9/report',
  '/erp/cashier-sessions/9/invoices',
  '/erp/branch-cashier-roster',
  '/erp/fixed-assets',
  '/erp/product-sync/links',
];

describe('reception login access', () => {
  it.each(readableAreas)('reads %s scoped to its own branch', async (path) => {
    const { app, calls } = makeApp('reception');

    const response = await request(app).get(`/api/v1${path}`).set('Cookie', cookie);

    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]!.args[0]).toEqual({ role: 'cashier', accountId: 22, branchId: 3 });
  });

  it.each(readableAreas)('cannot change anything in %s', async (path) => {
    const { app, calls } = makeApp('reception');

    for (const send of [
      request(app).post(`/api/v1${path}`),
      request(app).put(`/api/v1${path}/1`),
      request(app).patch(`/api/v1${path}/1`),
      request(app).delete(`/api/v1${path}/1`),
    ]) {
      const response = await send.set('Cookie', cookie).send({});
      expect(response.status).toBe(403);
    }
    expect(calls).toEqual([]);
  });

  it.each(closedAreas)('is refused from %s', async (path) => {
    const { app, calls, shiftCalls } = makeApp('reception');

    const response = await request(app).get(`/api/v1${path}`).set('Cookie', cookie);

    expect(response.status).toBe(403);
    expect(calls).toEqual([]);
    expect(shiftCalls).toEqual([]);
  });

  it('sees the status of the branch shift it shares with the cashier', async () => {
    const { app, shiftCalls } = makeApp('reception');

    const response = await request(app).get('/api/v1/erp/cashier-sessions/current').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ id: 9, openedByUsername: 'cashier.one' });
    expect(shiftCalls[0]!.args[0]).toEqual({ role: 'cashier', accountId: 22, branchId: 3 });
  });

  it.each(['/erp/cashier-sessions/open', '/erp/cashier-sessions/close'])(
    'cannot open or close the shift through %s',
    async (path) => {
      const { app, shiftCalls } = makeApp('reception');

      const response = await request(app).post(`/api/v1${path}`).set('Cookie', cookie).send({});

      expect(response.status).toBe(403);
      expect(shiftCalls).toEqual([]);
    },
  );

  it.each(readableAreas)('is held out of %s while no shift is open', async (path) => {
    const { app, calls } = makeApp('reception', { shiftOpen: false });

    const response = await request(app).get(`/api/v1${path}`).set('Cookie', cookie);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ERP_RECEPTION_SHIFT_CLOSED');
    expect(calls).toEqual([]);
  });

  describe('front-desk work it may do inside the shared shift', () => {
    const reassignBody = {
      employeeId: 7, reason: 'الموظف الصحيح', operationReference: crypto.randomUUID(),
    };
    /** Each command reception may run, with a body the route accepts. */
    const commands: Array<[string, string, string, Record<string, unknown>]> = [
      ['changes the employee of a service', 'post', '/erp/sales/invoices/4/queue/8/reassign', reassignBody],
      ['adds a supplier', 'post', '/erp/suppliers', { name: 'مورد جديد' }],
      ['edits a supplier', 'patch', '/erp/suppliers/5', { phone: '01000000000' }],
      ['cancels a purchase', 'post', '/erp/suppliers/purchases/6/cancel', { reason: 'خطأ في الكمية' }],
    ];

    it.each(commands)('%s scoped to its own branch', async (_label, method, path, body) => {
      const { app, calls } = makeApp('reception');

      const response = await (request(app) as unknown as Record<string, (url: string) => request.Test>)[method]!(`/api/v1${path}`)
        .set('Cookie', cookie).send(body);

      expect(response.status).toBeLessThan(300);
      expect(calls[0]!.args[0]).toEqual({ role: 'cashier', accountId: 22, branchId: 3 });
    });

    it.each(commands)('cannot do it (%s) while no shift is open', async (_label, method, path, body) => {
      const { app, calls } = makeApp('reception', { shiftOpen: false });

      const response = await (request(app) as unknown as Record<string, (url: string) => request.Test>)[method]!(`/api/v1${path}`)
        .set('Cookie', cookie).send(body);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('ERP_RECEPTION_SHIFT_CLOSED');
      expect(calls).toEqual([]);
    });

    it.each(['/erp/suppliers', '/erp/suppliers/purchases', '/erp/assignable-employees'])(
      'reads %s inside the shift and is held out of it without one',
      async (path) => {
        const open = makeApp('reception');
        const read = await request(open.app).get(`/api/v1${path}`).set('Cookie', cookie);
        expect(read.status).toBe(200);
        expect(open.calls[0]!.args[0]).toEqual({ role: 'cashier', accountId: 22, branchId: 3 });

        const closed = makeApp('reception', { shiftOpen: false });
        const held = await request(closed.app).get(`/api/v1${path}`).set('Cookie', cookie);
        expect(held.status).toBe(409);
        expect(closed.calls).toEqual([]);
      },
    );

    it.each([
      '/erp/sales/4/refunds',
      '/erp/sales/4/refunds/quote',
      '/erp/sales/4/void',
      '/erp/sales/invoices/4/payments',
      '/erp/sales/quote',
    ])('still cannot change money on an invoice through %s', async (path) => {
      const { app, calls } = makeApp('reception');

      const response = await request(app).post(`/api/v1${path}`).set('Cookie', cookie).send({});

      expect(response.status).toBe(403);
      expect(calls).toEqual([]);
    });
  });

  it('lets a cashier read without an open shift as before', async () => {
    const { app, calls } = makeApp('cashier', { shiftOpen: false });

    const response = await request(app).get('/api/v1/erp/clients').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('cannot see the per-employee commission rates of a service', async () => {
    const { app, calls } = makeApp('reception');

    const response = await request(app)
      .get('/api/v1/erp/services/5/commission-overrides')
      .set('Cookie', cookie);

    expect(response.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('leaves the cashier login able to reach commissions and change records', async () => {
    const { app } = makeApp('cashier');

    expect((await request(app).get('/api/v1/erp/commissions').set('Cookie', cookie)).status)
      .not.toBe(403);
    expect((await request(app).post('/api/v1/erp/clients').set('Cookie', cookie).send({})).status)
      .not.toBe(403);
  });
});
