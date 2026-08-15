import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import type { AuthService } from '../../src/modules/auth/index.js';
import { createExpenseService, type ExpenseRepository } from '../../src/modules/erp/expenses/index.js';

const repository: ExpenseRepository = {
  create: async () => { throw new Error('not called'); },
  findById: async () => null,
  list: async () => ({ items: [], total: 0 }),
  correct: async () => { throw new Error('not called'); },
};
const service = createExpenseService({
  repository,
  resolveBranchContext: async (actor, branchId) => ({ accountId: actor.accountId, accountRole: actor.role, employeeId: 'employeeId' in actor ? actor.employeeId : null, branchId: branchId ?? 1 }),
});
const appAs = (session: unknown) => createApp({
  authService: { authenticate: async () => session } as unknown as AuthService,
  erpExpenseService: service,
});

const admin = { actorType: 'account', accountRole: 'admin', accountId: 2, employeeId: null };
const cashier = { actorType: 'account', accountRole: 'cashier', accountId: 3, employeeId: 4 };

describe('ERP expenses mounting', () => {
  it('mounts expense history behind ERP authentication for both account roles', async () => {
    expect((await request(appAs(admin)).get('/api/v1/erp/expenses?branchId=1')).status).toBe(200);
    expect((await request(appAs(cashier)).get('/api/v1/erp/expenses')).status).toBe(200);
    expect((await request(appAs(null)).get('/api/v1/erp/expenses?branchId=1')).status).toBe(401);
    expect((await request(appAs({ actorType: 'employee', employeeId: 4 })).get('/api/v1/erp/expenses?branchId=1')).status).toBe(403);
  });

  it('refuses a correction from a cashier', async () => {
    const response = await request(appAs(cashier))
      .post('/api/v1/erp/expenses/10/corrections')
      .send({ categoryId: 4, amount: '1.00', expenseDate: '2026-08-05', description: 'x', reason: 'x' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ERP_EXPENSE_ADMIN_REQUIRED');
  });
});
