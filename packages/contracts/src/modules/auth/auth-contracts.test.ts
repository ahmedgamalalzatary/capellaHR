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
      deviceProof: { challengeId: '00000000-0000-4000-8000-000000000001', installationMarker: 'marker-marker-123', response: { id: 'credential-id', rawId: 'credential-id', type: 'public-key', response: { clientDataJSON: 'encoded', authenticatorData: 'auth', signature: 'signature' }, clientExtensionResults: {} } },
    }).success).toBe(true);
  });

  it('caps employee codes at the signed MySQL INT range', () => {
    const login = Reflect.get(contracts, 'employeeLoginSchema');
    const deviceProof = { challengeId: '00000000-0000-4000-8000-000000000001', installationMarker: 'marker-marker-123', response: { id: 'credential-id', rawId: 'credential-id', type: 'public-key', response: { clientDataJSON: 'encoded', authenticatorData: 'auth', signature: 'signature' }, clientExtensionResults: {} } };
    expect(login.safeParse({ employeeCode: 2147483648, pin: '1234', personalPhone: '01012345678', deviceProof }).success).toBe(false);
  });

  it('returns the Western-digit instruction for Arabic-Indic login phones', () => {
    const login = Reflect.get(contracts, 'employeeLoginSchema');
    const deviceProof = { challengeId: '00000000-0000-4000-8000-000000000001', installationMarker: 'marker-marker-123', response: { id: 'credential-id', rawId: 'credential-id', type: 'public-key', response: { clientDataJSON: 'encoded', authenticatorData: 'auth', signature: 'signature' }, clientExtensionResults: {} } };
    const result = login.safeParse({ employeeCode: 1, pin: '1234', personalPhone: '٠١٠١٢٣٤٥٦٧٨', deviceProof });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('استخدم الأرقام الإنجليزية من 0 إلى 9');
  });
});
