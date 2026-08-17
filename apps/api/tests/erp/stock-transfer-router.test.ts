import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { StockTransferError } from '../../src/modules/erp/transfers/index.js';

const transfer = {
  id: 4,
  sourceBranchId: 2,
  sourceBranchName: 'فرع مدينة نصر',
  destinationBranchId: 3,
  destinationBranchName: 'فرع المعادي',
  invoiceId: 90,
  invoiceNumber: 'INV.2026.08.17.0001',
  transferDate: '2026-08-17',
  totalCost: '120.00',
  note: null,
  actingAccountId: 1,
  createdAt: new Date('2026-08-17T09:00:00.000Z'),
  lines: [{
    sourceProductId: 7, destinationProductId: 21, productName: 'شامبو',
    quantity: 4, unitCost: '30.00', lineTotal: '120.00',
  }],
};

const body = {
  idempotencyKey: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1660',
  sourceBranchId: 2,
  destinationBranchId: 3,
  lines: [{ productId: 7, quantity: 4 }],
};

const setup = () => {
  const service = {
    transfer: vi.fn(async () => transfer),
    list: vi.fn(async () => ({ items: [transfer], total: 1 })),
  };
  const authService = {
    authenticate: vi.fn(async (token: string) => token === 'admin'
      ? { actorType: 'account' as const, accountId: 1, accountRole: 'admin' as const, employeeId: null }
      : token === 'cashier'
        ? {
            actorType: 'account' as const, accountId: 8, accountRole: 'cashier' as const,
            employeeId: null, branchId: 2,
          }
        : null),
  };
  const app = createApp({
    authService,
    erpStockTransferService: service,
    secureCookies: false,
  } as never);
  return { app, service };
};

describe('ERP stock transfer routes', () => {
  it('posts a transfer for an admin and passes only the authenticated identity', async () => {
    const { app, service } = setup();

    const response = await request(app)
      .post('/api/v1/erp/stock-transfers')
      .set('Cookie', 'capella_session=admin')
      .send(body);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ id: 4, totalCost: '120.00' });
    expect(service.transfer).toHaveBeenCalledWith(
      { role: 'admin', accountId: 1 },
      expect.objectContaining({ sourceBranchId: 2, destinationBranchId: 3 }),
    );
  });

  it('turns a refused transfer into the right status', async () => {
    const { app, service } = setup();
    service.transfer.mockRejectedValueOnce(new StockTransferError('TRANSFER_SHIFT_REQUIRED'));
    const shift = await request(app).post('/api/v1/erp/stock-transfers')
      .set('Cookie', 'capella_session=admin').send(body);

    service.transfer.mockRejectedValueOnce(new StockTransferError('TRANSFER_ADMIN_REQUIRED'));
    const forbidden = await request(app).post('/api/v1/erp/stock-transfers')
      .set('Cookie', 'capella_session=cashier').send(body);

    service.transfer.mockRejectedValueOnce(new StockTransferError('PRODUCT_NOT_FOUND'));
    const missing = await request(app).post('/api/v1/erp/stock-transfers')
      .set('Cookie', 'capella_session=admin').send(body);

    expect(shift.status).toBe(409);
    expect(shift.body.error).toMatchObject({ code: 'TRANSFER_SHIFT_REQUIRED' });
    expect(forbidden.status).toBe(403);
    expect(missing.status).toBe(404);
  });

  it('rejects a seller on a transfer, which nobody sells', async () => {
    const { app, service } = setup();

    const response = await request(app)
      .post('/api/v1/erp/stock-transfers')
      .set('Cookie', 'capella_session=admin')
      .send({ ...body, sellerEmployeeId: 11 });

    expect(response.status).toBe(400);
    expect(service.transfer).not.toHaveBeenCalled();
  });

  it('rejects a transfer that does not name two different branches', async () => {
    const { app, service } = setup();

    const response = await request(app)
      .post('/api/v1/erp/stock-transfers')
      .set('Cookie', 'capella_session=admin')
      .send({ ...body, destinationBranchId: 2 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.fieldErrors).toHaveProperty('destinationBranchId');
    expect(service.transfer).not.toHaveBeenCalled();
  });

  it('lists transfers with pagination metadata', async () => {
    const { app, service } = setup();

    const response = await request(app)
      .get('/api/v1/erp/stock-transfers?page=1&pageSize=20&branchId=2')
      .set('Cookie', 'capella_session=admin');

    expect(response.status).toBe(200);
    expect(response.body.meta).toMatchObject({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
    expect(service.list).toHaveBeenCalledWith(
      { role: 'admin', accountId: 1 },
      expect.objectContaining({ branchId: 2 }),
    );
  });

  it('turns an unauthenticated caller away before the service is reached', async () => {
    const { app, service } = setup();

    const response = await request(app).post('/api/v1/erp/stock-transfers').send(body);

    expect(response.status).toBe(401);
    expect(service.transfer).not.toHaveBeenCalled();
  });
});
