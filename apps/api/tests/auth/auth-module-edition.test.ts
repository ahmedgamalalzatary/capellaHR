import type { createDatabase } from '@capella/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const cashierRepositoryCalls = vi.hoisted(() => vi.fn());

vi.mock('../../src/modules/auth/cashier-accounts-repository.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/modules/auth/cashier-accounts-repository.js')>();
  return {
    ...actual,
    createDrizzleCashierAccountRepository: (...args: Parameters<typeof actual.createDrizzleCashierAccountRepository>) => {
      cashierRepositoryCalls(...args);
      return actual.createDrizzleCashierAccountRepository(...args);
    },
  };
});

import { createAuthModule } from '../../src/modules/auth/auth-module.js';

describe('Auth module edition composition', () => {
  beforeEach(() => cashierRepositoryCalls.mockClear());

  it('does not construct Cashier account management when ERP is disabled', () => {
    const module = createAuthModule({
      database: {} as ReturnType<typeof createDatabase>,
      cashierAccountsEnabled: false,
    });

    expect(cashierRepositoryCalls).not.toHaveBeenCalled();
    expect(module.cashierAccounts).toBeUndefined();
  });

  it('retains Cashier account management when ERP is enabled', () => {
    const module = createAuthModule({
      database: {} as ReturnType<typeof createDatabase>,
      cashierAccountsEnabled: true,
    });

    expect(cashierRepositoryCalls).toHaveBeenCalledOnce();
    expect(module.cashierAccounts).toBeDefined();
  });
});
