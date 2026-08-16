import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';

import * as salesSchema from '../../../../src/schema/erp/sales/index.js';

describe('ERP Cashier-session schema', () => {
  it('defines branch-scoped account ownership and durable open/close facts', () => {
    const sessions = Reflect.get(salesSchema, 'cashierSessions');

    expect(sessions).toBeDefined();
    expect(Object.keys(sessions)).toEqual(expect.arrayContaining([
      'id',
      'branchId',
      'openedByAccountId',
      'openedAt',
      'closedAt',
      'closedByAccountId',
      'openBranchId',
    ]));
    expect(sessions.branchId.notNull).toBe(true);
    expect(sessions.openedByAccountId.notNull).toBe(true);
    expect(sessions.openedAt.notNull).toBe(true);
    expect(sessions.closedAt.notNull).toBe(false);
    expect(sessions.closedByAccountId.notNull).toBe(false);
  });

  it('enforces one open session per branch and consistent close ownership', () => {
    const sessions = Reflect.get(salesSchema, 'cashierSessions');
    const config = getTableConfig(sessions);

    expect(config.indexes.map((index) => index.config.name)).toContain(
      'erp_cashier_sessions_open_branch_unique',
    );
    expect(config.checks.map((check) => check.name)).toContain(
      'erp_cashier_sessions_close_state',
    );
  });
});
