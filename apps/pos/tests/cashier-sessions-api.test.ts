import { describe, expect, it } from 'vitest';

import * as cashierSessions from '../src/features/cashier-sessions';

describe('Cashier-session POS API boundary', () => {
  it('publishes the complete Cashier-session API through the feature boundary', () => {
    expect(Reflect.get(cashierSessions, 'getCurrentCashierSession')).toBeTypeOf('function');
    expect(Reflect.get(cashierSessions, 'openCashierSession')).toBeTypeOf('function');
    expect(Reflect.get(cashierSessions, 'closeCashierSession')).toBeTypeOf('function');
    expect(Reflect.get(cashierSessions, 'recoveryCloseCashierSession')).toBeTypeOf('function');
    expect(Reflect.get(cashierSessions, 'listCashierSessionBranches')).toBeTypeOf('function');
  });
});
