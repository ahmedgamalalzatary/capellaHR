import { describe, expect, test } from 'vitest';

import { cn } from './cn';

describe('cn', () => {
  test('joins conditional class values', () => {
    const inactive = Boolean(0);
    expect(cn('a', inactive && 'b', 'c')).toBe('a c');
  });

  test('later tailwind utilities override earlier conflicting ones', () => {
    expect(cn('p-2 text-ink', 'p-4')).toBe('text-ink p-4');
  });

  test('keeps rtl-aware logical utilities distinct', () => {
    expect(cn('ms-2', 'me-4')).toBe('ms-2 me-4');
  });
});
