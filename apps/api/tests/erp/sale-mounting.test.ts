import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import type { AuthService } from '../../src/modules/auth/index.js';
import { SaleError, type SaleService } from '../../src/modules/erp/sales/index.js';

const saleService = {
  quote: vi.fn().mockResolvedValue({
    lines: [{
      itemType: 'service', sourceId: 21, name: 'صبغة', quantity: 1,
      unitPrice: '200.00', lineTotal: '200.00',
    }],
    discount: null,
    tax: null,
    totals: {
      subtotal: '200.00', discountAmount: '0.00', taxAmount: '0.00', total: '200.00',
    },
  }),
  listInvoices: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  getInvoice: vi.fn().mockResolvedValue({ id: 44 }),
} as unknown as SaleService;

const appAs = (session: unknown) => createApp({
  authService: { authenticate: async () => session } as unknown as AuthService,
  erpSaleService: saleService,
});

describe('ERP sales mounting', () => {
  it('serves quote endpoints only to authenticated ERP accounts', async () => {
    const body = {
      lines: [{ itemType: 'service', serviceId: 21, quantity: 1, unitPrice: '200' }],
    };
    const cashier = await request(appAs({
      actorType: 'account', accountRole: 'cashier', accountId: 2, branchId: 4,
    })).post('/api/v1/erp/sales/quote').send(body);
    expect(cashier.status).toBe(200);
    expect(cashier.body.data.totals.total).toBe('200.00');
    expect((await request(appAs(null)).post('/api/v1/erp/sales/quote').send(body)).status).toBe(401);
    expect((await request(appAs({ actorType: 'employee', employeeId: 4 }))
      .post('/api/v1/erp/sales/quote').send(body)).status).toBe(403);
  });

  it('protects invoice history and detail with the same ERP account boundary', async () => {
    const cashierSession = {
      actorType: 'account', accountRole: 'cashier', accountId: 2, branchId: 4,
    };
    expect((await request(appAs(cashierSession)).get('/api/v1/erp/sales')).status).toBe(200);
    expect((await request(appAs(cashierSession)).get('/api/v1/erp/sales/44')).status).toBe(200);
    expect((await request(appAs(null)).get('/api/v1/erp/sales')).status).toBe(401);
    expect((await request(appAs({ actorType: 'employee', employeeId: 4 }))
      .get('/api/v1/erp/sales/44')).status).toBe(403);
  });

  it('propagates request IDs through stable receipt errors without exposing internals', async () => {
    const failing = {
      ...saleService,
      getInvoice: vi.fn().mockRejectedValue(new SaleError('INVOICE_NOT_FOUND')),
    } as unknown as SaleService;
    const response = await request(createApp({
      authService: { authenticate: async () => ({
        actorType: 'account', accountRole: 'cashier', accountId: 2, branchId: 4,
      }) } as unknown as AuthService,
      erpSaleService: failing,
    })).get('/api/v1/erp/sales/44').set('x-request-id', 'receipt-correlation-4');
    expect(response.status).toBe(404);
    expect(response.headers['x-request-id']).toBe('receipt-correlation-4');
    expect(response.body.error).toMatchObject({
      code: 'INVOICE_NOT_FOUND', requestId: 'receipt-correlation-4',
    });
    expect(JSON.stringify(response.body)).not.toContain('SQL');
  });
});
