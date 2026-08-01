import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import {
  createErpBranchContextResolver,
  type ErpBranchCapability,
  type ErpEmployeeCapability,
} from '../../src/modules/erp/index.js';
import {
  createClientService,
  createErpClientsRouter,
  type ClientRecord,
  type ClientRepository,
} from '../../src/modules/erp/clients/index.js';

const record = (overrides: Partial<ClientRecord> = {}): ClientRecord => ({
  id: 1,
  branchId: 1,
  fullName: 'ندى سمير',
  phone: '01001234567',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

// Branch 1 belongs to the cashier's employee; branch 2 exists but is not theirs.
const branches = {
  findById: vi.fn(async (id: number) => (id === 1 || id === 2 ? { id, name: `فرع ${id}` } : null)),
} as unknown as ErpBranchCapability;

const employees = {
  findActiveById: vi.fn(async (id: number) => (
    id === 4 ? { id: 4, employeeCode: 100, fullName: 'كاشير', branchId: 1 } : null
  )),
} as unknown as ErpEmployeeCapability;

const repository = (overrides: Partial<ClientRepository> = {}): ClientRepository => ({
  create: vi.fn(async (input: Parameters<ClientRepository['create']>[0]) => record(input)),
  findById: vi.fn(async () => record()),
  findByPhone: vi.fn(async () => null),
  list: vi.fn(async () => ({ items: [record()], total: 1 })),
  update: vi.fn(async () => record()),
  ...overrides,
});

const ADMIN = { type: 'admin', accountId: 1 };
const CASHIER = { type: 'cashier', accountId: 2, employeeId: 4 };

/** Real service and real resolver over a fake repository, so the HTTP layer
 *  exercises the actual branch rules rather than a stubbed service. */
const makeApp = (actor: unknown, repo: ClientRepository = repository()) => {
  const service = createClientService({
    repository: repo,
    resolveBranchContext: createErpBranchContextResolver({ branches, employees }),
  });
  const app = express();
  app.use(express.json());
  app.use((_request, response, next) => { response.locals.actor = actor; next(); });
  app.use('/api/v1/erp/clients', createErpClientsRouter(service));
  return app;
};

const body = { fullName: 'ندى سمير', phone: '01001234567' };

describe('ERP clients HTTP API', () => {
  it('refuses an employee session and an admin session with no acting account', async () => {
    // Employees are never ERP business actors, and every ERP write must record
    // the acting account, so an accountless admin session cannot act either.
    expect((await request(makeApp({ type: 'employee', employeeId: 4 })).get('/api/v1/erp/clients')).status).toBe(403);
    expect((await request(makeApp({ type: 'admin' })).get('/api/v1/erp/clients')).status).toBe(403);
  });

  it('requires an admin to name the branch they act on', async () => {
    const response = await request(makeApp(ADMIN)).get('/api/v1/erp/clients');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('ERP_BRANCH_REQUIRED');
  });

  it('rejects an admin naming a branch that does not exist', async () => {
    const response = await request(makeApp(ADMIN)).get('/api/v1/erp/clients?branchId=99');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ERP_BRANCH_NOT_FOUND');
  });

  it('derives the cashier branch from their employee rather than the request', async () => {
    const create = vi.fn(async (input: Parameters<ClientRepository['create']>[0]) => record(input));
    const app = makeApp(CASHIER, repository({ create }));

    expect((await request(app).post('/api/v1/erp/clients').send(body)).status).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ branchId: 1 }));
  });

  it('stops a cashier from acting on another branch', async () => {
    const response = await request(makeApp(CASHIER))
      .post('/api/v1/erp/clients').send({ ...body, branchId: 2 });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ERP_BRANCH_FORBIDDEN');
  });

  it('returns field errors for an invalid phone', async () => {
    const response = await request(makeApp(CASHIER))
      .post('/api/v1/erp/clients').send({ ...body, phone: '01301234567' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.fieldErrors.phone).toBeDefined();
  });

  it('returns the existing client id on a duplicate phone', async () => {
    const repo = repository({ findByPhone: vi.fn(async () => record({ id: 42 })) });
    const response = await request(makeApp(CASHIER, repo)).post('/api/v1/erp/clients').send(body);

    expect(response.status).toBe(409);
    expect(response.body.error).toMatchObject({ code: 'CLIENT_PHONE_EXISTS', existingClientId: 42 });
  });

  it('routes /by-phone to the lookup instead of parsing it as an id', async () => {
    const findByPhone = vi.fn(async () => record());
    const app = makeApp(CASHIER, repository({ findByPhone }));

    const response = await request(app).get('/api/v1/erp/clients/by-phone?phone=%2B20+100+123+4567');

    expect(response.status).toBe(200);
    expect(findByPhone).toHaveBeenCalledWith(1, '01001234567');
  });

  it('reports a missing client as 404', async () => {
    const repo = repository({ findById: vi.fn(async () => null) });
    const response = await request(makeApp(CASHIER, repo)).get('/api/v1/erp/clients/3');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('CLIENT_NOT_FOUND');
  });
});
