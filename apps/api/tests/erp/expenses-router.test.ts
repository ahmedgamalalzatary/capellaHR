import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createErpExpensesRouter } from '../../src/modules/erp/expenses/expense-router.js';

const actor = { accountId: 1, type: 'admin' };
const service = {
  create: vi.fn().mockResolvedValue({ id: 1 }),
  get: vi.fn().mockResolvedValue({ id: 1 }),
  list: vi.fn().mockResolvedValue({ items: [{ id: 1 }], total: 21 }),
  correct: vi.fn().mockResolvedValue({ original: { id: 1 }, reversal: { id: 2 }, replacement: { id: 3 } }),
};
const app = () => {
  const value = express(); value.use(express.json()); value.use((_req, res, next) => { res.locals.actor = actor; next(); });
  value.use('/expenses', createErpExpensesRouter(service as never)); return value;
};

describe('expense router', () => {
  it('creates, reads and paginates expenses', async () => {
    await request(app()).post('/expenses').send({ branchId: 2, name: 'كهرباء', amount: '10', expenseDate: '2026-08-05', description: 'x' }).expect(201);
    await request(app()).get('/expenses/1?branchId=2').expect(200);
    const response = await request(app()).get('/expenses?branchId=2&page=2&pageSize=20').expect(200);
    expect(response.body.meta).toMatchObject({ page: 2, total: 21, totalPages: 2 });
  });

  it('exposes correction as an explicit mutation', async () => {
    const response = await request(app()).post('/expenses/1/corrections').send({ branchId: 2, name: 'كهرباء', amount: '9', expenseDate: '2026-08-05', description: 'x', reason: 'wrong' }).expect(201);
    expect(response.body.data.reversal.id).toBe(2);
  });

  it('returns field validation errors', async () => {
    const response = await request(app()).post('/expenses').send({ branchId: 2 }).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
