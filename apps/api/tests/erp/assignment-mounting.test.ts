import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import type { AuthService } from '../../src/modules/auth/index.js';
import {
  createEmployeeAssignmentService,
  createErpBranchContextResolver,
} from '../../src/modules/erp/index.js';

const nada = { id: 7, employeeCode: 42, fullName: 'ندى سمير', branchId: 1 };

const service = createEmployeeAssignmentService({
  attendance: {
    listPresentEmployees: async () => [nada],
    findPresentEmployee: async () => nada,
  },
  resolveBranchContext: createErpBranchContextResolver({
    branches: { findById: async (id: number) => ({ id, name: 'فرع' }) },
  }),
});

const appAs = (session: unknown) => createApp({
  authService: { authenticate: async () => session } as unknown as AuthService,
  erpAssignmentService: service,
});

const CASHIER_SESSION = {
  actorType: 'account', accountRole: 'cashier', accountId: 2, employeeId: null, branchId: 1,
};

describe('ERP assignable-employees mounting', () => {
  it('serves the endpoint to an authenticated ERP account', async () => {
    const response = await request(appAs(CASHIER_SESSION))
      .get('/api/v1/erp/assignable-employees');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([nada]);
  });

  it('rejects an unauthenticated caller and an HR employee session', async () => {
    expect((await request(appAs(null)).get('/api/v1/erp/assignable-employees')).status).toBe(401);
    expect((await request(appAs({ actorType: 'employee', employeeId: 4 }))
      .get('/api/v1/erp/assignable-employees')).status).toBe(403);
  });
});
