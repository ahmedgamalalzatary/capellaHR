import { describe, expect, it } from 'vitest';

import * as auth from '../../src/modules/auth/index.js';

describe('authentication persistence adapters', () => {
  it('exposes a Drizzle repository factory for the service ports', () => {
    expect(Reflect.get(auth, 'createDrizzleAuthRepositories')).toBeTypeOf('function');
  });
});
