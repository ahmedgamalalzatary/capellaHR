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
};

const setup = () => {
  const service = {
    open: vi.fn(async () => session),
    current: vi.fn(async () => session),
    requireOpenForCashier: vi.fn(async () => session),
    close: vi.fn(async () => ({
      ...session,
      closedAt: now,
      closedByAccountId: 8,
      closedByUsername: 'cashier.one',
    })),
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
});
