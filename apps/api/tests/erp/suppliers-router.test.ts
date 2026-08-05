import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createErpSuppliersRouter, type SupplierPurchaseService } from '../../src/modules/erp/suppliers/index.js';

const service = {
  createSupplier: vi.fn(async () => ({ id: 3 })), listSuppliers: vi.fn(async () => ({ items: [], total: 0 })), getSupplier: vi.fn(), updateSupplier: vi.fn(),
  postPurchase: vi.fn(async () => ({ id: 9, total: '20.00', status: 'posted' })), listPurchases: vi.fn(async () => ({ items: [], total: 0 })),
  getPurchase: vi.fn(), cancelPurchase: vi.fn(async () => ({ id: 9, status: 'cancelled' })),
} as unknown as SupplierPurchaseService;
const app = () => {
  const value = express(); value.use(express.json());
  value.use((_request, response, next) => { response.locals.actor = { type: 'admin', accountId: 7 }; next(); });
  value.use('/suppliers', createErpSuppliersRouter(service)); return value;
};

describe('ERP supplier and purchase HTTP API', () => {
  it('exposes supplier CRUD and paginated history', async () => {
    await request(app()).post('/suppliers').send({ branchId: 2, name: 'Nile' }).expect(201);
    const result = await request(app()).get('/suppliers?branchId=2').expect(200);
    expect(result.body.meta).toEqual({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  });

  it('posts and cancels purchases with stable validation', async () => {
    await request(app()).post('/suppliers/purchases').send({ branchId: 2, idempotencyKey: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1630', supplierId: 3, purchaseDate: '2026-08-05', lines: [{ productId: 11, quantity: 2, unitCost: '10' }] }).expect(201);
    await request(app()).post('/suppliers/purchases/9/cancel').send({ branchId: 2, reason: 'خطأ' }).expect(200);
    await request(app()).post('/suppliers/purchases/9/cancel').send({ branchId: 2, reason: '' }).expect(400);
  });
});
