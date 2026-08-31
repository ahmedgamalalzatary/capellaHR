import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import {
  CashierSessionError,
  createCashierSessionsRouter,
  type CashierSessionService,
} from '../../src/modules/erp/sales/index.js';

const now = new Date('2026-08-01T09:30:00.000Z');
const session = {
  id: 14,
  branchId: 3,
  branchName: 'الفرع الرئيسي',
  openedByAccountId: 8,
  openedByUsername: 'cashier.one',
  openedAt: now,
  closedAt: null,
  closedByAccountId: null,
  closedByUsername: null,
  autoClosedAt: null,
};

const summary = {
  ...session,
  durationMinutes: 90,
  saleCount: 2,
  taken: { cash: '400.00', visa: '0.00', instapay: '0.00', vodafone_cash: '0.00' },
  refunded: { cash: '50.00', visa: '0.00', instapay: '0.00', vodafone_cash: '0.00' },
  takenTotal: '400.00',
  refundedTotal: '50.00',
  net: '350.00',
};

const report = {
  summary,
  sales: {
    gross: '500.00', returns: '50.00', total: '450.00',
    discount: '25.00', tax: '5.00', net: '430.00',
  },
  expenses: '30.00',
  collectedPayments: '20.00',
  creditSales: '100.00',
  netByMethod: { cash: '350.00', visa: '0.00', instapay: '0.00', vodafone_cash: '0.00' },
};

const setup = () => {
  const service = {
    closeExpired: vi.fn(async () => []),
    open: vi.fn(async () => session),
    current: vi.fn(async () => session),
    close: vi.fn(async () => ({
      ...session,
      closedAt: now,
      closedByAccountId: 8,
      closedByUsername: 'cashier.one',
    })),
    list: vi.fn(async () => ({ items: [summary], total: 1, page: 1, pageSize: 20 })),
    summary: vi.fn(async () => summary),
    report: vi.fn(async () => report),
    detail: vi.fn(async () => ({ summary, invoices: [] })),
    recoveryClose: vi.fn(async () => ({
      ...session,
      closedAt: now,
      closedByAccountId: 1,
      closedByUsername: 'admin@capella.test',
    })),
  } satisfies CashierSessionService;
  const authService = {
    authenticate: vi.fn(async (token: string) => token === 'cashier'
      ? {
          actorType: 'account' as const,
          accountId: 8,
          accountRole: 'cashier' as const,
          employeeId: null,
          branchId: 3,
        }
      : token === 'admin'
        ? {
            actorType: 'account' as const,
            accountId: 1,
            accountRole: 'admin' as const,
            employeeId: null,
          }
        : token === 'employee'
          ? {
              actorType: 'employee' as const,
              accountId: null,
              accountRole: null,
              branchId: 3,
            }
          : null),
  };
  const app = createApp({
    authService,
    cashierSessionService: service,
    secureCookies: false,
  } as never);
  return { app, authService, service };
};

describe('ERP Cashier-session routes', () => {
  it('opens a Cashier session and passes only the authenticated account identity', async () => {
    const { app, service } = setup();
    const response = await request(app)
      .post('/api/v1/erp/cashier-sessions/open')
      .set('Cookie', 'capella_session=cashier')
      .send({ branchId: 99 });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ id: 14, branchId: 3 });
    expect(service.open).toHaveBeenCalledWith({
      role: 'cashier',
      accountId: 8,
      branchId: 3,
    });
  });

  it('reads a Cashier branch implicitly and an Admin-selected branch explicitly', async () => {
    const cashier = setup();
    expect((await request(cashier.app)
      .get('/api/v1/erp/cashier-sessions/current')
      .set('Cookie', 'capella_session=cashier')).status).toBe(200);
    expect(cashier.service.current).toHaveBeenCalledWith({
      role: 'cashier', accountId: 8, branchId: 3,
    }, undefined);

    const admin = setup();
    expect((await request(admin.app)
      .get('/api/v1/erp/cashier-sessions/current?branchId=4')
      .set('Cookie', 'capella_session=admin')).status).toBe(200);
    expect(admin.service.current).toHaveBeenCalledWith({
      role: 'admin', accountId: 1,
    }, 4);
  });

  it('normally closes as the authenticated Cashier', async () => {
    const { app, service } = setup();
    const response = await request(app)
      .post('/api/v1/erp/cashier-sessions/close')
      .set('Cookie', 'capella_session=cashier');

    expect(response.status).toBe(200);
    expect(service.close).toHaveBeenCalledWith({
      role: 'cashier', accountId: 8, branchId: 3,
    });
  });

  it('recovery-closes as Admin with a validated mandatory reason', async () => {
    const { app, service } = setup();
    const response = await request(app)
      .post('/api/v1/erp/cashier-sessions/14/recovery-close')
      .set('Cookie', 'capella_session=admin')
      .send({ reason: '  انقطاع الجهاز  ' });

    expect(response.status).toBe(200);
    expect(service.recoveryClose).toHaveBeenCalledWith(
      { role: 'admin', accountId: 1 },
      14,
      'انقطاع الجهاز',
    );
  });

  it('rejects missing recovery reasons before invoking the service', async () => {
    const { app, service } = setup();
    const response = await request(app)
      .post('/api/v1/erp/cashier-sessions/14/recovery-close')
      .set('Cookie', 'capella_session=admin')
      .send({ reason: '   ' });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(service.recoveryClose).not.toHaveBeenCalled();
  });

  it('rejects a Cashier from recovery-close before validating its payload', async () => {
    const { app, service } = setup();
    const response = await request(app)
      .post('/api/v1/erp/cashier-sessions/not-an-id/recovery-close')
      .set('Cookie', 'capella_session=cashier')
      .send({ reason: '   ' });

    expect(response.status).toBe(403);
    expect(response.body.error).toMatchObject({
      code: 'ERP_CASHIER_SESSION_ADMIN_REQUIRED',
    });
    expect(service.recoveryClose).not.toHaveBeenCalled();
  });

  it('rejects missing, employee, and invalid ERP sessions', async () => {
    const { app, service } = setup();
    expect((await request(app).post('/api/v1/erp/cashier-sessions/open')).status).toBe(401);
    expect((await request(app)
      .post('/api/v1/erp/cashier-sessions/open')
      .set('Cookie', 'capella_session=employee')).status).toBe(403);
    expect(service.open).not.toHaveBeenCalled();
  });

  it('maps expected session conflicts to stable REST errors', async () => {
    const { app, service } = setup();
    service.open.mockRejectedValueOnce(new CashierSessionError(
      'ERP_CASHIER_SESSION_ALREADY_OPEN',
      'توجد وردية مفتوحة',
    ));
    const response = await request(app)
      .post('/api/v1/erp/cashier-sessions/open')
      .set('Cookie', 'capella_session=cashier');

    expect(response.status).toBe(409);
    expect(response.body.error).toMatchObject({
      code: 'ERP_CASHIER_SESSION_ALREADY_OPEN',
      message: 'توجد وردية مفتوحة',
    });
  });

  it('forwards unexpected errors to the next Express error handler', async () => {
    const unexpected = new Error('database unavailable');
    const { service } = setup();
    service.open.mockRejectedValueOnce(unexpected);
    const router = createCashierSessionsRouter(service);
    const openLayer = router.stack.find((layer) => layer.route?.path === '/open');
    const handler = openLayer?.route?.stack[0]?.handle;
    const next = vi.fn();
    const response = {
      locals: { actor: { type: 'cashier', accountId: 8, branchId: 3 } },
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    if (!handler) throw new Error('Expected the open route handler');

    await handler({} as never, response as never, next);

    expect(next).toHaveBeenCalledWith(unexpected);
  });

  it('pages the shift history and reports the money each shift moved', async () => {
    const { app, service } = setup();
    const response = await request(app)
      .get('/api/v1/erp/cashier-sessions?page=2&pageSize=5')
      .set('Cookie', 'capella_session=cashier');

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({ id: 14, net: '350.00', durationMinutes: 90 });
    expect(response.body.meta).toMatchObject({ page: 2, pageSize: 5, total: 1 });
    expect(service.list).toHaveBeenCalledWith(
      { role: 'cashier', accountId: 8, branchId: 3 },
      { page: 2, pageSize: 5 },
    );
  });

  it('reads one shift and the sales behind it', async () => {
    const { app, service } = setup();

    const one = await request(app)
      .get('/api/v1/erp/cashier-sessions/14')
      .set('Cookie', 'capella_session=admin');
    expect(one.status).toBe(200);
    expect(one.body.data).toMatchObject({ id: 14, saleCount: 2 });
    expect(service.summary).toHaveBeenCalledWith({ role: 'admin', accountId: 1 }, 14);

    const detail = await request(app)
      .get('/api/v1/erp/cashier-sessions/14/invoices')
      .set('Cookie', 'capella_session=admin');
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({ summary: { id: 14 }, invoices: [] });
  });

  it('returns the dedicated full shift-ending report', async () => {
    const { app, service } = setup();
    const response = await request(app)
      .get('/api/v1/erp/cashier-sessions/14/report')
      .set('Cookie', 'capella_session=cashier');

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      summary: { id: 14 },
      sales: { net: '430.00' },
      expenses: '30.00',
      creditSales: '100.00',
    });
    expect(service.report).toHaveBeenCalledWith(
      { role: 'cashier', accountId: 8, branchId: 3 },
      14,
    );
  });

  it('answers a shift the actor may not read with the service refusal', async () => {
    const { app, service } = setup();
    service.summary.mockRejectedValue(new CashierSessionError(
      'ERP_CASHIER_SESSION_NOT_OWNER',
      'لا يمكن عرض وردية فتحها حساب كاشير آخر',
    ));

    const response = await request(app)
      .get('/api/v1/erp/cashier-sessions/14')
      .set('Cookie', 'capella_session=cashier');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ERP_CASHIER_SESSION_NOT_OWNER');
  });

  it('rejects an unreadable shift identifier before reaching the service', async () => {
    const { app, service } = setup();

    const response = await request(app)
      .get('/api/v1/erp/cashier-sessions/abc')
      .set('Cookie', 'capella_session=admin');

    expect(response.status).toBe(400);
    expect(service.summary).not.toHaveBeenCalled();
  });
});
