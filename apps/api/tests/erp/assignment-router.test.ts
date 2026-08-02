import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import {
  createErpBranchContextResolver,
  type ErpBranchCapability,
  type ErpEmployeeCapability,
} from '../../src/modules/erp/index.js';
import {
  createEmployeeAssignmentService,
  createErpAssignmentRouter,
} from '../../src/modules/erp/assignment/index.js';

const nada = { id: 7, employeeCode: 42, fullName: 'ندى سمير', branchId: 1 };

// Branch 1 belongs to the cashier's employee; branch 2 exists but is not theirs.
const branches = {
  findById: vi.fn(async (id: number) => (id === 1 || id === 2 ? { id, name: `فرع ${id}` } : null)),
} as unknown as ErpBranchCapability;

const employees = {
  findActiveById: vi.fn(async (id: number) => (
    id === 4 ? { id: 4, employeeCode: 100, fullName: 'كاشير', branchId: 1 } : null
  )),
} as unknown as ErpEmployeeCapability;

const ADMIN = { type: 'admin', accountId: 1 };
const CASHIER = { type: 'cashier', accountId: 2, employeeId: 4 };

/** Real service and real resolver over a fake capability, so the HTTP layer
 *  exercises the actual branch rules rather than a stubbed service. */
const makeApp = (
  actor: unknown,
  listPresentEmployees: (branchId: number) => Promise<typeof nada[]> = async () => [nada],
) => {
  const service = createEmployeeAssignmentService({
    attendance: { listPresentEmployees, findPresentEmployee: async () => nada },
    resolveBranchContext: createErpBranchContextResolver({ branches, employees }),
  });
  const app = express();
  app.use(express.json());
  app.use((_request, response, next) => { response.locals.actor = actor; next(); });
  app.use('/api/v1/erp/assignable-employees', createErpAssignmentRouter(service));
  return app;
};

describe('ERP assignable-employees HTTP API', () => {
  it('refuses an employee session and an admin session with no acting account', async () => {
    expect((await request(makeApp({ type: 'employee', employeeId: 4 }))
      .get('/api/v1/erp/assignable-employees')).status).toBe(403);
    expect((await request(makeApp({ type: 'admin' }))
      .get('/api/v1/erp/assignable-employees')).status).toBe(403);
  });

  it('returns the employees currently present in the cashier branch', async () => {
    const listPresentEmployees = vi.fn(async () => [nada]);
    const response = await request(makeApp(CASHIER, listPresentEmployees))
      .get('/api/v1/erp/assignable-employees');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([nada]);
    expect(listPresentEmployees).toHaveBeenCalledWith(1);
  });

  it('returns an empty list rather than an error when nobody is checked in', async () => {
    const response = await request(makeApp(CASHIER, async () => []))
      .get('/api/v1/erp/assignable-employees');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it('requires an admin to name the branch they act on', async () => {
    const response = await request(makeApp(ADMIN)).get('/api/v1/erp/assignable-employees');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('ERP_BRANCH_REQUIRED');
  });

  it('rejects an admin naming a branch that does not exist', async () => {
    const response = await request(makeApp(ADMIN))
      .get('/api/v1/erp/assignable-employees?branchId=99');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ERP_BRANCH_NOT_FOUND');
  });

  it('stops a cashier from listing another branch', async () => {
    const response = await request(makeApp(CASHIER))
      .get('/api/v1/erp/assignable-employees?branchId=2');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ERP_BRANCH_FORBIDDEN');
  });

  it('returns field errors for an invalid branch identifier', async () => {
    const response = await request(makeApp(ADMIN))
      .get('/api/v1/erp/assignable-employees?branchId=abc');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.fieldErrors.branchId).toBeDefined();
  });
});
