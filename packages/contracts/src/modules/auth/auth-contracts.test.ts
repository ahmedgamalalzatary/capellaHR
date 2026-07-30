import { describe, expect, it } from 'vitest';

import * as contracts from './index.js';

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

  it('validates cashier promotion credentials at the boundary', () => {
    const schema = Reflect.get(contracts, 'promoteCashierSchema');

    expect(schema.parse({ employeeId: 7, username: ' Cashier.One ', password: 'long-secret' }))
      .toEqual({ employeeId: 7, username: 'cashier.one', password: 'long-secret' });
    expect(schema.safeParse({ employeeId: 7, username: ' ', password: 'long-secret' }).success).toBe(false);
    expect(schema.safeParse({ employeeId: 7, username: 'cashier', password: '' }).success).toBe(false);
    expect(schema.safeParse({ employeeId: 7, username: 'x'.repeat(256), password: 'long-secret' }).success).toBe(false);
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
