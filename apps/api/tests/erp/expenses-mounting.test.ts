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

describe('ERP expenses mounting', () => {
  it('mounts expense history behind ERP authentication and admin authorization', async () => {
    const admin = { actorType: 'account', accountRole: 'admin', accountId: 2, employeeId: null };
    const cashier = { actorType: 'account', accountRole: 'cashier', accountId: 3, employeeId: 4 };

    expect((await request(appAs(admin)).get('/api/v1/erp/expenses?branchId=1')).status).toBe(200);
    expect((await request(appAs(null)).get('/api/v1/erp/expenses?branchId=1')).status).toBe(401);
    expect((await request(appAs(cashier)).get('/api/v1/erp/expenses?branchId=1')).status).toBe(403);
    expect((await request(appAs({ actorType: 'employee', employeeId: 4 })).get('/api/v1/erp/expenses?branchId=1')).status).toBe(403);
  });
});
