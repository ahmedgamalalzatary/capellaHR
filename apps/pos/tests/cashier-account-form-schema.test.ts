import { describe, expect, test } from 'vitest';

import {
  branchCashierCredentialsFormSchema,
  resetCashierPasswordFormSchema,
} from '../src/features/cashier-accounts/schemas/cashier-account-schemas';

describe('branchCashierCredentialsFormSchema', () => {
  const valid = { branchId: '3', username: 'Nasr', password: 'secret123' };

  test('coerces branchId to a number and lowercases the username', () => {
    const parsed = branchCashierCredentialsFormSchema.parse(valid);
    expect(parsed.branchId).toBe(3);
    expect(parsed.username).toBe('nasr');
  });

  test('trims surrounding whitespace from the username', () => {
    const parsed = branchCashierCredentialsFormSchema.parse({ ...valid, username: '  nasr  ' });
    expect(parsed.username).toBe('nasr');
  });

  test('requires a positive branchId with an Arabic message', () => {
    const result = branchCashierCredentialsFormSchema.safeParse({ ...valid, branchId: '0' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.branchId?.[0]).toBe('يجب اختيار الفرع');
    }
  });

  test('rejects an empty username with an Arabic message', () => {
    const result = branchCashierCredentialsFormSchema.safeParse({ ...valid, username: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.username?.[0]).toBe('اسم المستخدم مطلوب');
    }
  });

  test('rejects an empty password with an Arabic message', () => {
    const result = branchCashierCredentialsFormSchema.safeParse({ ...valid, password: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.password?.[0]).toBe('كلمة المرور مطلوبة');
    }
  });

  test('rejects a username over 255 characters with an Arabic message', () => {
    const result = branchCashierCredentialsFormSchema.safeParse({ ...valid, username: 'a'.repeat(256) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.username?.[0]).toBe('اسم المستخدم طويل جدًا');
    }
  });

  test('rejects a password over 1024 characters with an Arabic message', () => {
    const result = branchCashierCredentialsFormSchema.safeParse({ ...valid, password: 'a'.repeat(1025) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.password?.[0]).toBe('كلمة المرور طويلة جدًا');
    }
  });
});

describe('resetCashierPasswordFormSchema', () => {
  test('accepts a fresh password within the contract cap', () => {
    expect(resetCashierPasswordFormSchema.safeParse({ password: 'next-secret' }).success).toBe(true);
    expect(resetCashierPasswordFormSchema.safeParse({ password: 'x'.repeat(1025) }).success).toBe(false);
  });
});
