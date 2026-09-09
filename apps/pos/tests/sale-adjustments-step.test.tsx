import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SaleAdjustmentsStep } from '../src/features/sales/components/sale-adjustments-step';

describe('SaleAdjustmentsStep', () => {
  afterEach(() => cleanup());

  it('opens the discount and tax fields by default', () => {
    render(
      <SaleAdjustmentsStep
        discountKind="percentage"
        discountValue=""
        onDiscountKind={() => undefined}
        onDiscountValue={() => undefined}
        taxKind="percentage"
        taxValue=""
        onTaxKind={() => undefined}
        onTaxValue={() => undefined}
      />,
    );

    const panel = screen.getByText('خصم / ضريبة').closest('details');
    expect(panel?.open).toBe(true);
    expect(screen.getByLabelText('قيمة الخصم')).toBeDefined();
    expect(screen.getByLabelText('قيمة الضريبة')).toBeDefined();
  });
});
