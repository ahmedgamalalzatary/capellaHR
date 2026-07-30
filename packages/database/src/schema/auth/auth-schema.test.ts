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

  it('defines employee-linked cashier accounts with branch scope', () => {
    const accounts = Reflect.get(authSchema, 'accounts');

    expect(accounts).toBeDefined();
    expect(getTableName(accounts)).toBe('accounts');
    expect(accounts.role).toBeDefined();
    expect(accounts.employeeId).toBeDefined();
    expect(Reflect.get(accounts, 'branchId')).toBeUndefined();
    expect(accounts.passwordHash).toBeDefined();
    expect(accounts.active).toBeDefined();
    expect(accounts.adminSingleton).toBeDefined();
    expect(getTableConfig(accounts).indexes.some(
      (item) => item.config.name === 'accounts_admin_singleton_unique',
    )).toBe(true);
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
