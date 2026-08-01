import { describe, expect, test } from 'vitest';

import {
  promoteCashierFormSchema,
  resetCashierPasswordFormSchema,
} from '../src/features/cashier-accounts/schemas/cashier-account-schemas';

describe('promoteCashierFormSchema', () => {
  const valid = { employeeId: '7', username: 'Cashier1', password: 'secret123' };

  test('coerces employeeId to a number and lowercases the username', () => {
    const parsed = promoteCashierFormSchema.parse(valid);
    expect(parsed.employeeId).toBe(7);
    expect(parsed.username).toBe('cashier1');
  });

  test('trims surrounding whitespace from the username', () => {
    const parsed = promoteCashierFormSchema.parse({ ...valid, username: '  cashier1  ' });
    expect(parsed.username).toBe('cashier1');
  });

  test('requires a positive integer employeeId with an Arabic message', () => {
    const result = promoteCashierFormSchema.safeParse({ ...valid, employeeId: '0' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.employeeId?.[0]).toBe('يجب اختيار الموظف');
    }
  });

  test('rejects an empty username with an Arabic message', () => {
    const result = promoteCashierFormSchema.safeParse({ ...valid, username: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.username?.[0]).toBe('اسم المستخدم مطلوب');
    }
  });

  test('rejects an empty password with an Arabic message', () => {
    const result = promoteCashierFormSchema.safeParse({ ...valid, password: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.password?.[0]).toBe('كلمة المرور مطلوبة');
    }
  });

  test('rejects a username over 255 characters with an Arabic message', () => {
    const result = promoteCashierFormSchema.safeParse({ ...valid, username: 'a'.repeat(256) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.username?.[0]).toBe('اسم المستخدم طويل جدًا');
    }
  });

  test('rejects a password over 1024 characters with an Arabic message', () => {
    const result = promoteCashierFormSchema.safeParse({ ...valid, password: 'a'.repeat(1025) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.password?.[0]).toBe('كلمة المرور طويلة جدًا');
    }
  });

  test('rejects a username that only exceeds 255 characters after lowercasing', () => {
    // Turkish dotted İ (U+0130) expands to two codepoints ("i" + combining dot) on lowercase,
    // so 255 of them pass a pre-lowercase length check but become 510 codepoints post-transform.
    const result = promoteCashierFormSchema.safeParse({ ...valid, username: 'İ'.repeat(255) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.username?.[0]).toBe('اسم المستخدم طويل جدًا');
    }
  });

  test('rejects an employeeId beyond the MySQL int range with an Arabic message', () => {
    const result = promoteCashierFormSchema.safeParse({ ...valid, employeeId: '9999999999' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.employeeId?.[0]).toBe('يجب اختيار الموظف');
    }
  });
});

describe('resetCashierPasswordFormSchema', () => {
  test('accepts a non-empty password', () => {
    const parsed = resetCashierPasswordFormSchema.parse({ password: 'newSecret1' });
    expect(parsed.password).toBe('newSecret1');
  });

  test('rejects an empty password with an Arabic message', () => {
    const result = resetCashierPasswordFormSchema.safeParse({ password: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.password?.[0]).toBe('كلمة المرور مطلوبة');
    }
  });

  test('rejects a password over 1024 characters with an Arabic message', () => {
    const result = resetCashierPasswordFormSchema.safeParse({ password: 'a'.repeat(1025) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.password?.[0]).toBe('كلمة المرور طويلة جدًا');
    }
  });
});
