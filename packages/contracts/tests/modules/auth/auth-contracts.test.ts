import { describe, expect, it } from 'vitest';

import * as contracts from '../../../src/modules/auth/index.js';

describe('authentication contracts', () => {
  it('accepts the admin login payload', () => {
    const schema = Reflect.get(contracts, 'adminLoginSchema');
    expect(schema).toBeDefined();
    expect(schema.parse({ email: 'admin@capella.test', password: 'secret' })).toEqual({
      email: 'admin@capella.test', password: 'secret',
    });
  });

  it('accepts a cashier username and password without employee self-service fields', () => {
    const schema = Reflect.get(contracts, 'cashierLoginSchema');

    expect(schema).toBeDefined();
    expect(schema.parse({ username: ' Cashier.One ', password: 'secret' })).toEqual({
      username: 'cashier.one',
      password: 'secret',
    });
    expect(schema.safeParse({
      username: 'cashier.one',
      password: 'secret',
      employeeCode: 12,
    }).success).toBe(false);
    expect(schema.safeParse({
      username: 'cashier.one',
      password: 'x'.repeat(1025),
    }).success).toBe(false);
  });

  it('validates branch cashier credentials at the boundary', () => {
    const schema = Reflect.get(contracts, 'upsertBranchCashierSchema');

    expect(schema.parse({ branchId: 2, username: ' Cashier.One ', password: 'long-secret' }))
      .toEqual({ branchId: 2, username: 'cashier.one', password: 'long-secret' });
    expect(schema.safeParse({ branchId: 2, username: ' ', password: 'long-secret' }).success).toBe(false);
    expect(schema.safeParse({ branchId: 2, username: 'cashier', password: '' }).success).toBe(false);
    expect(schema.safeParse({ branchId: 0, username: 'cashier', password: 'long-secret' }).success).toBe(false);
    expect(schema.safeParse({ branchId: 2, username: 'x'.repeat(256), password: 'long-secret' }).success).toBe(false);
  });

  it('validates cashier account-management requests', () => {
    expect(contracts.listCashierAccountsSchema.parse({ page: '2', pageSize: '50' }))
      .toEqual({ page: 2, pageSize: 50 });
    expect(contracts.listCashierAccountsSchema.safeParse({ page: 1, pageSize: 101 }).success)
      .toBe(false);
    expect(contracts.cashierAccountStatusSchema.parse({ active: false })).toEqual({ active: false });
    expect(contracts.cashierAccountStatusSchema.safeParse({ active: false, role: 'admin' }).success)
      .toBe(false);
    expect(contracts.resetCashierPasswordSchema.safeParse({ password: '' }).success).toBe(false);
    expect(contracts.resetCashierPasswordSchema.safeParse({ password: 'x'.repeat(1025) }).success)
      .toBe(false);
  });

  it('validates password-safe branch cashier account responses', () => {
    const account = {
      id: 3,
      username: 'cashier.one',
      role: 'cashier' as const,
      branchId: 2,
      branchName: 'فرع مدينة نصر',
      active: true,
    };

    expect(contracts.publicCashierAccountSchema.parse(account)).toEqual(account);
    expect(contracts.publicCashierAccountSchema.safeParse({
      ...account,
      passwordHash: 'must-not-leak',
    }).success).toBe(false);
    expect(contracts.publicCashierAccountSchema.safeParse({
      ...account,
      employeeId: 7,
    }).success).toBe(false);
  });

  it('keeps ERP account sessions distinct from employee self-service sessions', () => {
    expect(contracts.accountSessionDataSchema.parse({ actor: { type: 'admin' } }))
      .toEqual({ actor: { type: 'admin' } });
    expect(contracts.accountSessionDataSchema.parse({
      actor: { type: 'cashier', accountId: 3 },
    })).toEqual({ actor: { type: 'cashier', accountId: 3 } });
    expect(contracts.accountSessionDataSchema.safeParse({
      actor: { type: 'cashier', accountId: 3, employeeId: 7 },
    }).success).toBe(false);
    expect(contracts.accountSessionDataSchema.safeParse({ actor: { type: 'employee' } }).success)
      .toBe(false);
    expect(contracts.authSessionDataSchema.parse({ actor: { type: 'employee' } }))
      .toEqual({ actor: { type: 'employee' } });
  });

  it('measures cashier usernames using MySQL Unicode character semantics', () => {
    const astral = '\u{1E900}';
    expect(contracts.cashierUsernameSchema.safeParse(astral.repeat(255)).success).toBe(true);
    expect(contracts.cashierUsernameSchema.safeParse(astral.repeat(256)).success).toBe(false);
    expect(contracts.cashierUsernameSchema.safeParse('\u0130'.repeat(255)).success).toBe(false);
  });

  it('rejects employee login PINs that are not exactly four digits', () => {
    const schema = Reflect.get(contracts, 'employeeLoginSchema');
    expect(schema).toBeDefined();
    expect(schema.safeParse({ employeeCode: 1, pin: '123', personalPhone: '01012345678', installationMarker: 'marker-marker-123' }).success).toBe(false);
    expect(schema.safeParse({ employeeCode: 1, pin: '12345', personalPhone: '01012345678', installationMarker: 'marker-marker-123' }).success).toBe(false);
    expect(schema.safeParse({ employeeCode: 1, pin: '12a4', personalPhone: '01012345678', installationMarker: 'marker-marker-123' }).success).toBe(false);
  });

  it('requires only the paired browser installation marker', () => {
    const schema = Reflect.get(contracts, 'employeeLoginSchema');
    const identity = { employeeCode: 1, pin: '1234', personalPhone: '01012345678' };

    expect(schema.safeParse(identity).success).toBe(false);
    expect(schema.safeParse({ ...identity, installationMarker: 'marker-marker-123' }).success).toBe(true);
    expect(schema.safeParse({ ...identity, installationMarker: 'short' }).success).toBe(false);
  });

  it('caps employee codes at the signed MySQL INT range', () => {
    const login = Reflect.get(contracts, 'employeeLoginSchema');
    expect(login.safeParse({ employeeCode: 2147483648, pin: '1234', personalPhone: '01012345678', installationMarker: 'marker-marker-123' }).success).toBe(false);
  });

  it('returns the Western-digit instruction for Arabic-Indic login phones', () => {
    const login = Reflect.get(contracts, 'employeeLoginSchema');
    const result = login.safeParse({ employeeCode: 1, pin: '1234', personalPhone: '٠١٠١٢٣٤٥٦٧٨', installationMarker: 'marker-marker-123' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('استخدم الأرقام الإنجليزية من 0 إلى 9');
  });
});
