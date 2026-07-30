import { describe, expect, it } from 'vitest';

import * as auth from '../../src/modules/auth/index.js';

describe('Cashier account persistence', () => {
  it('exports the production Drizzle repository', () => {
    expect(Reflect.get(auth, 'createDrizzleCashierAccountRepository')).toBeTypeOf('function');
  });
});
