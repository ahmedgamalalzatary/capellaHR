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

  it('records a system close with no closing account', () => {
    const sessions = Reflect.get(salesSchema, 'cashierSessions');

    expect(Object.keys(sessions)).toContain('autoClosedAt');
    expect(sessions.autoClosedAt.notNull).toBe(false);
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

  it('pins a system close to the exact sixteen-hour mark of the shift', () => {
    const sessions = Reflect.get(salesSchema, 'cashierSessions');
    const closeState = getTableConfig(sessions).checks
      .find((check) => check.name === 'erp_cashier_sessions_close_state')!;

    const text = closeState.value.queryChunks
      .flatMap((chunk) => (chunk instanceof Object && 'value' in chunk ? chunk.value : []))
      .join(' ');

    expect(text).toContain('interval 16 hour');
  });
});
