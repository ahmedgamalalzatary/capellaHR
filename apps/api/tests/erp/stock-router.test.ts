import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createErpProductsRouter, type ProductStockService } from '../../src/modules/erp/stock/index.js';

const service = {
  create: vi.fn(async () => ({ id: 1, quantity: 0 })),
  get: vi.fn(), list: vi.fn(async () => ({ items: [], total: 0 })), update: vi.fn(),
  adjust: vi.fn(async () => ({ product: { id: 1, quantity: 4 }, movementId: 9 })),
  listMovements: vi.fn(async () => ({ items: [], total: 0 })),
} as unknown as ProductStockService;

const app = () => {
  const value = express();
  value.use(express.json());
  value.use((_request, response, next) => { response.locals.actor = { type: 'admin', accountId: 7 }; next(); });
  value.use('/products', createErpProductsRouter(service));
  return value;
};

describe('ERP product stock HTTP API', () => {
  it('creates products and exposes pagination metadata', async () => {
    await request(app()).post('/products').send({ branchId: 2, name: 'Shampoo', sellingPrice: '100' }).expect(201);
    const response = await request(app()).get('/products?branchId=2').expect(200);
    expect(response.body.meta).toEqual({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  });

  it('validates and applies an explicit stock adjustment', async () => {
    const response = await request(app()).post('/products/1/adjustments').send({ branchId: 2, quantityDelta: 4, reason: 'count_correction' }).expect(200);
    expect(response.body.data).toMatchObject({ movementId: 9 });
  });
});
