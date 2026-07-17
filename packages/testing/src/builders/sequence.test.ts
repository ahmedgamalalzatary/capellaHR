import { describe, expect, test } from 'vitest';

import { createSequence } from './sequence.js';

describe('createSequence', () => {
  test('issues consecutive integers starting after the seed', () => {
    const next = createSequence(5);
    expect(next()).toBe(6);
    expect(next()).toBe(7);
  });

  test('starts at 1 by default, matching employee-code allocation', () => {
    const next = createSequence();
    expect(next()).toBe(1);
  });

  test('independent sequences do not share state', () => {
    const a = createSequence();
    const b = createSequence();
    a();
    expect(b()).toBe(1);
  });
});
