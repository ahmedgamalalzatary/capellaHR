import { describe, expect, it } from 'vitest';

import {
  availableCommission,
  canPayCommission,
  carriedCommissionDebt,
} from '../../src/modules/erp/commissions/commission-domain.js';

describe('commission available balance', () => {
  it('subtracts already-paid commission from the net earned balance', () => {
    expect(availableCommission('1000.00', '200.00')).toBe('800.00');
    expect(availableCommission('1000.00', '1000.00')).toBe('0.00');
    expect(availableCommission('250.00', '0.00')).toBe('250.00');
  });

  it('exposes a negative balance when a refund left more paid than earned', () => {
    expect(availableCommission('300.00', '500.00')).toBe('-200.00');
  });

  it('reserves future commission for carried overpayments and prior reversals', () => {
    expect(availableCommission('250.00', '50.00', '100.00')).toBe('100.00');
    expect(availableCommission('80.00', '0.00', '100.00')).toBe('-20.00');
  });

  it('carries overpaid commission across unfinalized months without pooling old surplus', () => {
    expect(carriedCommissionDebt('0.00', [
      { net: '1000.00', paid: '0.00', reversals: '0.00' },
      { net: '0.00', paid: '100.00', reversals: '0.00' },
      { net: '40.00', paid: '0.00', reversals: '0.00' },
    ])).toBe('60.00');
  });

  it('allows a payout only when it fits inside the non-negative available balance', () => {
    expect(canPayCommission('800.00', '200.00')).toBe(true);
    expect(canPayCommission('800.00', '800.00')).toBe(true);
    expect(canPayCommission('800.00', '800.01')).toBe(false);
    expect(canPayCommission('0.00', '0.01')).toBe(false);
    expect(canPayCommission('-200.00', '0.01')).toBe(false);
  });
});
