import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import type { BranchCashierRosterService } from '../../src/modules/erp/sales/index.js';

const members = [{ id: 7, employeeCode: 1007, fullName: 'أحمد جمال' }];

const setup = () => {
  const replace = vi.fn(async (_actor: unknown, query: { branchId?: number }, input: { employeeIds: number[] }) => (
    query.branchId === 3 || query.branchId === undefined
      ? input.employeeIds.map((id) => ({ id, employeeCode: 1007, fullName: 'أحمد جمال' }))
      : []
  ));
  const service = {
    list: vi.fn(async () => members),
    replace,
  } as unknown as BranchCashierRosterService;
  const authService = {
    authenticate: vi.fn(async (token: string) => token === 'cashier'
      ? {
          actorType: 'account' as const,
          accountId: 8,
          accountRole: 'cashier' as const,
          employeeId: null,
          branchId: 3,
        }
      : token === 'admin'
        ? {
            actorType: 'account' as const,
            accountId: 1,
            accountRole: 'admin' as const,
            employeeId: null,
          }
        : null),
  };
  const app = createApp({
    authService,
    erpBranchCashierRosterService: service,
    secureCookies: false,
  } as never);
  return { app, replace };
};

describe('ERP branch cashier roster routes', () => {
  it('serves the roster to an authenticated cashier of the branch', async () => {
    const { app } = setup();
    const response = await request(app)
      .get('/api/v1/erp/branch-cashier-roster')
      .set('Cookie', 'capella_session=cashier');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: [{ id: 7, employeeCode: 1007, fullName: 'أحمد جمال' }] });
  });

  it('lets only an admin replace the roster', async () => {
    const { app, replace } = setup();
    const forbidden = await request(app)
      .put('/api/v1/erp/branch-cashier-roster')
      .set('Cookie', 'capella_session=cashier')
      .send({ employeeIds: [7] });
    const replaced = await request(app)
      .put('/api/v1/erp/branch-cashier-roster?branchId=3')
      .set('Cookie', 'capella_session=admin')
      .send({ employeeIds: [7, 9] });

    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toMatchObject({ code: 'ERP_ROSTER_ADMIN_REQUIRED' });
    expect(replaced.status).toBe(200);
    expect(replaced.body.data).toEqual([
      { id: 7, employeeCode: 1007, fullName: 'أحمد جمال' },
      { id: 9, employeeCode: 1007, fullName: 'أحمد جمال' },
    ]);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('rejects duplicate roster members before touching the service', async () => {
    const { app, replace } = setup();
    const response = await request(app)
      .put('/api/v1/erp/branch-cashier-roster')
      .set('Cookie', 'capella_session=admin')
      .send({ employeeIds: [7, 7] });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(replace).not.toHaveBeenCalled();
  });
});
