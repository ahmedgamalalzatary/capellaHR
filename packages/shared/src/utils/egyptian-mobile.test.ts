import { describe, expect, test } from 'vitest';

import { isNormalizedEgyptianMobile, normalizeEgyptianMobile } from './egyptian-mobile.js';

describe('isNormalizedEgyptianMobile', () => {
  test.each(['01012345678', '01112345678', '01212345678', '01512345678'])(
    'accepts normalized number %s',
    (value) => {
      expect(isNormalizedEgyptianMobile(value)).toBe(true);
    },
  );

  test.each([
    '01312345678', // 013 prefix not allowed
    '0101234567', // 10 digits
    '010123456789', // 12 digits
    '010 1234 5678', // separators
    '+201012345678', // country code
    '01o12345678', // letter
    '',
  ])('rejects %j', (value) => {
    expect(isNormalizedEgyptianMobile(value)).toBe(false);
  });
});

describe('normalizeEgyptianMobile', () => {
  test('strips spaces, dashes, and Arabic-Indic digits', () => {
    expect(normalizeEgyptianMobile('٠١٠ 1234-5678')).toBe('01012345678');
  });

  test('converts +20 country prefix to local 0 prefix', () => {
    expect(normalizeEgyptianMobile('+20 101 234 5678')).toBe('01012345678');
  });

  test('returns null when the result is not a valid Egyptian mobile', () => {
    expect(normalizeEgyptianMobile('12345')).toBeNull();
  });
});
