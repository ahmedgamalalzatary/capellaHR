import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import type { AuthService } from '../../src/modules/auth/index.js';
import type { SupplierPurchaseService } from '../../src/modules/erp/suppliers/index.js';

const service = { listSuppliers: vi.fn(async () => ({ items: [], total: 0 })), listPurchases: vi.fn(async () => ({ items: [], total: 0 })) } as unknown as SupplierPurchaseService;
const appAs = (session: unknown) => createApp({ authService: { authenticate: async () => session } as unknown as AuthService, erpSupplierPurchaseService: service });

describe('ERP suppliers mounting', () => {
  it('mounts the slice behind the ERP account boundary', async () => {
    expect((await request(appAs({ actorType: 'account', accountRole: 'admin', accountId: 2 })).get('/api/v1/erp/suppliers?branchId=1')).status).toBe(200);
    expect((await request(appAs(null)).get('/api/v1/erp/suppliers?branchId=1')).status).toBe(401);
    expect((await request(appAs({ actorType: 'employee', employeeId: 4 })).get('/api/v1/erp/suppliers?branchId=1')).status).toBe(403);
  });
});
