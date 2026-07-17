import { describe, expect, it } from 'vitest';

import { branches } from './index.js';

describe('branches schema', () => {
  it('exports the persistent branch table', () => {
    expect(branches.id).toBeDefined();
    expect(branches.nameNormalized).toBeDefined();
    expect(branches.hasEverBeenReferenced).toBeDefined();
  });
});
