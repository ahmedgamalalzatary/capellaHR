import { getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';

import * as authSchema from './index.js';

describe('authentication database schema', () => {
  it('defines persistent sessions without storing raw tokens', () => {
    const sessions = Reflect.get(authSchema, 'authSessions');

    expect(sessions).toBeDefined();
    expect(getTableName(sessions)).toBe('auth_sessions');
    expect(sessions.tokenHash).toBeDefined();
    expect(Reflect.get(sessions, 'token')).toBeUndefined();
  });

  it('defines permanent authentication attempt records', () => {
    const attempts = Reflect.get(authSchema, 'authAttempts');

    expect(attempts).toBeDefined();
    expect(getTableName(attempts)).toBe('auth_attempts');
    expect(attempts.succeeded).toBeDefined();
    expect(attempts.reason).toBeDefined();
  });

  it('defines branch-scoped cashier accounts with one active login per branch', () => {
    const accounts = Reflect.get(authSchema, 'accounts');

    expect(accounts).toBeDefined();
    expect(getTableName(accounts)).toBe('accounts');
    expect(accounts.role).toBeDefined();
    // Legacy per-employee cashier rows keep their link; new logins carry the branch.
    expect(accounts.employeeId).toBeDefined();
    expect(accounts.branchId).toBeDefined();
    expect(accounts.activeCashierBranch).toBeDefined();
    expect(accounts.passwordHash).toBeDefined();
    expect(accounts.active).toBeDefined();
    expect(accounts.adminSingleton).toBeDefined();
    const config = getTableConfig(accounts);
    expect(config.indexes.map((item) => item.config.name)).toEqual(expect.arrayContaining([
      'accounts_admin_singleton_unique',
      'accounts_active_cashier_branch_unique',
    ]));
    expect(config.foreignKeys.map((item) => item.getName())).toContain('accounts_branch_fk');
    expect(config.checks.map((item) => item.name)).toContain('accounts_role_scope_consistency');
  });

  it('links account sessions to accounts without storing a duplicate employee identity', () => {
    const sessions = Reflect.get(authSchema, 'authSessions');

    expect(sessions.accountId).toBeDefined();
    expect(sessions.employeeId).toBeDefined();
  });

  it('defines durable atomic login-limit counters', () => {
    const limits = Reflect.get(authSchema, 'authLoginLimits');

    expect(limits).toBeDefined();
    expect(getTableName(limits)).toBe('auth_login_limits');
    expect(limits.key).toBeDefined();
    expect(limits.attemptCount).toBeDefined();
    expect(limits.version).toBeDefined();
    expect(limits.windowStartedAt).toBeDefined();
    expect(getTableConfig(limits).indexes.some(
      (item) => item.config.name === 'auth_login_limits_updated_idx',
    )).toBe(true);
  });
});
