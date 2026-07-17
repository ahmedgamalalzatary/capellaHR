import { describe, expect, it } from 'vitest';

import * as auth from '../../src/modules/auth/index.js';

describe('employee PIN validation', () => {
  it('accepts exactly four numeric digits', () => {
    const validatePin = Reflect.get(auth, 'validateEmployeePin');

    expect(validatePin).toBeTypeOf('function');
    expect(validatePin('0123')).toBe(true);
  });

  it('stores a PIN as a one-way Argon2 hash', async () => {
    const hashPin = Reflect.get(auth, 'hashEmployeePin');
    const verifyPin = Reflect.get(auth, 'verifyEmployeePin');

    expect(hashPin).toBeTypeOf('function');
    expect(verifyPin).toBeTypeOf('function');
    const stored = await hashPin('0123');
    expect(stored).not.toContain('0123');
    await expect(verifyPin(stored, '0123')).resolves.toBe(true);
    await expect(verifyPin(stored, '9999')).resolves.toBe(false);
  });
});
