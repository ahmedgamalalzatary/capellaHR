import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createErpSalesRouter } from '../../src/modules/erp/sales/sale-router.js';
import { SaleError, type SaleService } from '../../src/modules/erp/sales/sale-service.js';

const actor = { role: 'cashier' as const, accountId: 3, branchId: 2 };

const setup = (overrides: Partial<SaleService> = {}) => {
  const quote = vi.fn().mockResolvedValue({ lines: [], totals: {} });
  const complete = vi.fn().mockResolvedValue({ id: 44 });
  const listClientVisits = vi.fn().mockResolvedValue({ items: [], total: 0 });
  const listInvoices = vi.fn().mockResolvedValue({ items: [], total: 0 });
  const getInvoice = vi.fn().mockResolvedValue({ id: 44 });
  const refund = vi.fn().mockResolvedValue({ id: 44, status: 'refunded' });
  const voidInvoice = vi.fn().mockResolvedValue({ id: 44, status: 'voided' });
  const quoteRefund = vi.fn().mockResolvedValue({ totals: { total: '185.00' } });
  const service = {
    quote,
    complete,
    listClientVisits,
    listInvoices,
    getInvoice,
    refund,
    void: voidInvoice,
    quoteRefund,
    ...overrides,
  };
  const app = express();
  app.use(express.json());
  app.use((_request, response, next) => {
    response.locals.actor = { type: 'cashier', accountId: 3, branchId: 2 };
    next();
  });
  app.use('/erp/sales', createErpSalesRouter(service));
  app.use((_error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    void _next;
    response.status(500).json({ error: { code: 'UNEXPECTED' } });
  });
  return { app, quote, complete, listClientVisits, listInvoices, getInvoice, refund, voidInvoice, quoteRefund };
};

describe('ERP sales router', () => {
  it('returns the authoritative quote for selected refund quantities', async () => {
    const { app, quoteRefund } = setup();
    const response = await request(app).post('/erp/sales/44/refunds/quote').send({
      branchId: 2, lines: [{ invoiceLineId: 81, quantity: 1 }],
    });
    expect(response.status).toBe(200);
    expect(quoteRefund).toHaveBeenCalledWith(actor, 44, {
      branchId: 2, lines: [{ invoiceLineId: 81, quantity: 1 }],
    });
  });

  it('validates and submits partial refund and same-day void commands', async () => {
    const { app, refund, voidInvoice } = setup();
    const refundResponse = await request(app).post('/erp/sales/44/refunds').send({
      branchId: 2,
      idempotencyKey: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1632',
      reason: '  عدم رضا العميل  ',
      lines: [{ invoiceLineId: 81, quantity: 1 }],
      payments: [{ method: 'cash', amount: '185' }],
    });
    expect(refundResponse.status).toBe(201);
    expect(refund).toHaveBeenCalledWith(actor, 44, expect.objectContaining({
      reason: 'عدم رضا العميل', payments: [{ method: 'cash', amount: '185.00' }],
    }));

    const voidResponse = await request(app).post('/erp/sales/44/void').send({
      idempotencyKey: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1633',
      reason: 'إدخال مكرر',
    });
    expect(voidResponse.status).toBe(201);
    expect(voidInvoice).toHaveBeenCalledWith(actor, 44, expect.objectContaining({
      reason: 'إدخال مكرر',
    }));
  });

  it('quotes a normalized service sale draft', async () => {
    const { app, quote } = setup();
    const response = await request(app).post('/erp/sales/quote').send({
      lines: [{ itemType: 'service', serviceId: 21, quantity: 2, unitPrice: '200' }],
      discount: { kind: 'percentage', value: '10' },
    });
    expect(response.status).toBe(200);
    expect(quote).toHaveBeenCalledWith(actor, {
      lines: [{ itemType: 'service', serviceId: 21, quantity: 2, unitPrice: '200.00' }],
      discount: { kind: 'percentage', value: '10.00' },
    });
  });

  it('completes a normalized sale and returns the stored invoice', async () => {
    const { app, complete } = setup();
    const response = await request(app).post('/erp/sales').send({
      clientId: 5,
      assignedEmployeeId: 8,
      sellerEmployeeId: 9,
      cashierSessionId: 13,
      idempotencyKey: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1630',
      lines: [{ itemType: 'service', serviceId: 21, quantity: 1, unitPrice: '200' }],
      payments: [{ method: 'cash', amount: '200' }],
    });
    expect(response.status).toBe(201);
    expect(response.body.data).toEqual({ id: 44 });
    expect(complete).toHaveBeenCalledWith(actor, expect.objectContaining({
      payments: [{ method: 'cash', amount: '200.00' }],
    }));
  });

  it('returns paged client visit history', async () => {
    const { app, listClientVisits } = setup();
    const response = await request(app).get('/erp/sales/clients/5/visits?page=2&pageSize=10');
    expect(response.status).toBe(200);
    expect(listClientVisits).toHaveBeenCalledWith(actor, 5, { page: 2, pageSize: 10 });
    expect(response.body.meta).toEqual({ page: 2, pageSize: 10, total: 0, totalPages: 0 });
  });

  it('returns paged invoice history and one stored receipt detail', async () => {
    const { app, listInvoices, getInvoice } = setup();
    const history = await request(app).get('/erp/sales?page=2&pageSize=10&branchId=3');
    expect(history.status).toBe(200);
    expect(listInvoices).toHaveBeenCalledWith(actor, { page: 2, pageSize: 10, branchId: 3 });
    expect(history.body.meta).toEqual({ page: 2, pageSize: 10, total: 0, totalPages: 0 });

    const detail = await request(app).get('/erp/sales/44?branchId=3');
    expect(detail.status).toBe(200);
    expect(detail.body.data).toEqual({ id: 44 });
    expect(getInvoice).toHaveBeenCalledWith(actor, 44, 3);
  });

  it('maps missing and invalid invoice detail requests safely', async () => {
    const missing = await request(setup({
      getInvoice: vi.fn().mockRejectedValue(new SaleError('INVOICE_NOT_FOUND')),
    }).app).get('/erp/sales/44');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('INVOICE_NOT_FOUND');

    const invalid = await request(setup().app).get('/erp/sales/not-an-id');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('SALE_VALIDATION_FAILED');
  });

  it('maps validation and stable sale failures without exposing internals', async () => {
    const invalid = await request(setup().app).post('/erp/sales/quote').send({ lines: [] });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('SALE_VALIDATION_FAILED');

    const conflict = await request(setup({
      complete: vi.fn().mockRejectedValue(new SaleError('IDEMPOTENCY_CONFLICT')),
    }).app).post('/erp/sales').send({
      clientId: 5,
      assignedEmployeeId: 8,
      sellerEmployeeId: 9,
      cashierSessionId: 13,
      idempotencyKey: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1630',
      lines: [{ itemType: 'service', serviceId: 21, quantity: 1, unitPrice: '200' }],
      payments: [{ method: 'cash', amount: '200' }],
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('forwards unknown errors to Express error middleware', async () => {
    const { app } = setup({ quote: vi.fn().mockRejectedValue(new Error('database secret')) });
    const response = await request(app).post('/erp/sales/quote').send({
      lines: [{ itemType: 'service', serviceId: 21, quantity: 1, unitPrice: '200' }],
    });
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: { code: 'UNEXPECTED' } });
    expect(JSON.stringify(response.body)).not.toContain('database secret');
  });
});
