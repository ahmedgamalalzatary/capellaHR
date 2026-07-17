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

  it('rejects employee login PINs that are not exactly four digits', () => {
    const schema = Reflect.get(contracts, 'employeeLoginSchema');
    expect(schema).toBeDefined();
    expect(schema.safeParse({ employeeCode: 1, pin: '123', personalPhone: '01012345678', deviceProof: 'proof' }).success).toBe(false);
    expect(schema.safeParse({ employeeCode: 1, pin: '12345', personalPhone: '01012345678', deviceProof: 'proof' }).success).toBe(false);
    expect(schema.safeParse({ employeeCode: 1, pin: '12a4', personalPhone: '01012345678', deviceProof: 'proof' }).success).toBe(false);
  });

  it('requires a structured WebAuthn device assertion', () => {
    const schema = Reflect.get(contracts, 'employeeLoginSchema');
    const identity = { employeeCode: 1, pin: '1234', personalPhone: '01012345678' };

    expect(schema.safeParse({ ...identity, deviceProof: 'opaque-string' }).success).toBe(false);
    expect(schema.safeParse({
      ...identity,
      deviceProof: { id: 'credential-id', response: { clientDataJSON: 'encoded' } },
    }).success).toBe(true);
  });
});
