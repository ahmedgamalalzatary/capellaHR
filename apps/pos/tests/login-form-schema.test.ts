import { describe, expect, test } from 'vitest';

import {
  adminLoginFormSchema,
  cashierLoginFormSchema,
} from '../src/features/auth/schemas/login-schemas';

describe('cashierLoginFormSchema', () => {
  const valid = { username: 'Cashier1', password: 'secret123' };

  test('trims and lowercases the username', () => {
    const parsed = cashierLoginFormSchema.parse({ ...valid, username: '  Cashier1  ' });
    expect(parsed.username).toBe('cashier1');
  });

  test('rejects an empty username with an Arabic message', () => {
    const result = cashierLoginFormSchema.safeParse({ ...valid, username: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.username?.[0]).toBe('اسم المستخدم مطلوب');
    }
  });

  test('rejects a username over 255 characters with an Arabic message', () => {
    const result = cashierLoginFormSchema.safeParse({ ...valid, username: 'a'.repeat(256) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.username?.[0]).toBe('اسم المستخدم طويل جدًا');
    }
  });

  test('rejects a username that only exceeds 255 characters after lowercasing', () => {
    // Turkish dotted İ (U+0130) expands to two codepoints ("i" + combining dot) on lowercase,
    // so 255 of them pass a pre-lowercase length check but become 510 codepoints post-transform.
    const result = cashierLoginFormSchema.safeParse({ ...valid, username: 'İ'.repeat(255) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.username?.[0]).toBe('اسم المستخدم طويل جدًا');
    }
  });

  test('rejects an empty password with an Arabic message', () => {
    const result = cashierLoginFormSchema.safeParse({ ...valid, password: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.password?.[0]).toBe('كلمة المرور مطلوبة');
    }
  });

  test('rejects a password over 1024 characters with an Arabic message', () => {
    const result = cashierLoginFormSchema.safeParse({ ...valid, password: 'a'.repeat(1025) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.password?.[0]).toBe('كلمة المرور طويلة جدًا');
    }
  });
});

describe('adminLoginFormSchema', () => {
  const valid = { email: 'admin@example.com', password: 'admin1234' };

  test('accepts a valid email and password', () => {
    const parsed = adminLoginFormSchema.parse(valid);
    expect(parsed.email).toBe('admin@example.com');
  });

  test('rejects an invalid email with an Arabic message', () => {
    const result = adminLoginFormSchema.safeParse({ ...valid, email: 'not-an-email' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.email?.[0]).toBe('بريد إلكتروني غير صالح');
    }
  });

  test('rejects an empty password with an Arabic message', () => {
    const result = adminLoginFormSchema.safeParse({ ...valid, password: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.password?.[0]).toBe('كلمة المرور مطلوبة');
    }
  });
});
