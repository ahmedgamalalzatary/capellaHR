import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import type { AuthService } from '../../src/modules/auth/index.js';
import type { SaleService } from '../../src/modules/erp/sales/index.js';

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
} as unknown as SaleService;

const appAs = (session: unknown) => createApp({
  authService: { authenticate: async () => session } as unknown as AuthService,
  erpSaleService: saleService,
});

describe('ERP sales mounting', () => {
  it('serves quote endpoints only to authenticated ERP accounts', async () => {
    const body = { lines: [{ itemType: 'service', serviceId: 21, quantity: 1 }] };
    const cashier = await request(appAs({
      actorType: 'account', accountRole: 'cashier', accountId: 2, employeeId: 4,
    })).post('/api/v1/erp/sales/quote').send(body);
    expect(cashier.status).toBe(200);
    expect(cashier.body.data.totals.total).toBe('200.00');
    expect((await request(appAs(null)).post('/api/v1/erp/sales/quote').send(body)).status).toBe(401);
    expect((await request(appAs({ actorType: 'employee', employeeId: 4 }))
      .post('/api/v1/erp/sales/quote').send(body)).status).toBe(403);
  });
});
