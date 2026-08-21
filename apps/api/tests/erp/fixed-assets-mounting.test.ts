import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import type { AuthService } from '../../src/modules/auth/index.js';
import {
  createFixedAssetService,
  type FixedAssetRecord,
  type FixedAssetRepository,
} from '../../src/modules/erp/fixed-assets/index.js';

const record: FixedAssetRecord = {
  id: 10, branchId: 1, name: 'مكيف', quantity: 3, unitPrice: '15000.00',
  location: 'صالة 1', note: '', purchasedOn: null, condition: 'good',
  actingAccountId: 2, actingUsername: 'admin',
  createdAt: new Date('2026-08-01T10:00:00Z'), updatedAt: new Date('2026-08-01T10:00:00Z'),
};
const repository: FixedAssetRepository = {
  create: async () => record,
  findById: async () => record,
  list: async () => ({ items: [record], total: 1 }),
  update: async () => record,
  remove: async () => true,
};
const service = createFixedAssetService({
  repository,
  resolveBranchContext: async (actor, branchId) => ({
    accountId: actor.accountId, accountRole: actor.role, employeeId: null, branchId: branchId ?? 1,
  }),
});
const appAs = (session: unknown) => createApp({
  authService: { authenticate: async () => session } as unknown as AuthService,
  erpFixedAssetService: service,
});

const admin = { actorType: 'account', accountRole: 'admin', accountId: 2, employeeId: null };
const cashier = { actorType: 'account', accountRole: 'cashier', accountId: 3, employeeId: null, branchId: 1 };

describe('ERP fixed assets mounting', () => {
  it('opens the register to an admin only', async () => {
    expect((await request(appAs(admin)).get('/api/v1/erp/fixed-assets?branchId=1')).status).toBe(200);
    expect((await request(appAs(cashier)).get('/api/v1/erp/fixed-assets?branchId=1')).status).toBe(403);
    expect((await request(appAs(null)).get('/api/v1/erp/fixed-assets?branchId=1')).status).toBe(401);
    expect((await request(appAs({ actorType: 'employee', employeeId: 4 })).get('/api/v1/erp/fixed-assets?branchId=1')).status).toBe(403);
  });

  it('writes, edits and removes a line', async () => {
    const created = await request(appAs(admin))
      .post('/api/v1/erp/fixed-assets')
      .send({ branchId: 1, name: 'مكيف', quantity: 3, unitPrice: '15000.00', location: 'صالة 1' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ id: 10, name: 'مكيف' });

    expect((await request(appAs(admin)).put('/api/v1/erp/fixed-assets/10').send({ branchId: 1, name: 'مكيف', quantity: 4 })).status).toBe(200);
    expect((await request(appAs(admin)).delete('/api/v1/erp/fixed-assets/10?branchId=1')).status).toBe(204);
  });

  it('offers no partial edit, since an edit rewrites the whole line', async () => {
    // PATCH would promise that an unsent field is left alone; the register replaces
    // the line, so a field left out is a field the admin cleared.
    expect((await request(appAs(admin)).patch('/api/v1/erp/fixed-assets/10').send({ branchId: 1, name: 'مكيف' })).status).toBe(404);
  });

  it('refuses a line the register does not hold', async () => {
    const missing = createFixedAssetService({
      repository: { ...repository, findById: async () => null },
      resolveBranchContext: async (actor, branchId) => ({
        accountId: actor.accountId, accountRole: actor.role, employeeId: null, branchId: branchId ?? 1,
      }),
    });
    const app = createApp({
      authService: { authenticate: async () => admin } as unknown as AuthService,
      erpFixedAssetService: missing,
    });
    const response = await request(app).delete('/api/v1/erp/fixed-assets/99?branchId=1');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('FIXED_ASSET_NOT_FOUND');
  });

  it('refuses a line with no name at all', async () => {
    const response = await request(appAs(admin)).post('/api/v1/erp/fixed-assets').send({ branchId: 1 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
