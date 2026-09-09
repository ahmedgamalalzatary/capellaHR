import type { PaymentMethod, SaleQuote } from '@capella/contracts';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SalePaymentStep } from '../src/features/sales/components/sale-payment-step';
import { paymentMethods } from '../src/features/sales/components/sale-primitives';

const emptyPayments = (): Record<PaymentMethod, string> => ({
  cash: '',
  visa: '',
  instapay: '',
  vodafone_cash: '',
});

const quote: SaleQuote = {
  lines: [{
    itemType: 'product',
    sourceId: 31,
    name: 'شامبو',
    quantity: 1,
    unitPrice: '500.00',
    lineTotal: '500.00',
  }],
  discount: null,
  tax: null,
  totals: { subtotal: '500.00', discountAmount: '0.00', taxAmount: '0.00', total: '500.00' },
};

function PaymentHarness({
  initial = emptyPayments(),
  remaining = BigInt(50000),
}: {
  initial?: Record<PaymentMethod, string>;
  remaining?: bigint | null;
}) {
  const [payments, setPayments] = useState(initial);
  return (
    <SalePaymentStep
      blockers={[]}
      hasLines
      quotePending={false}
      quoteIsError={false}
      quoteError={null}
      quoteData={quote}
      onRecalculateQuote={() => undefined}
      onRemoveServices={() => undefined}
      payments={payments}
      onPaymentChange={(method, value) => {
        setPayments((current) => ({ ...current, [method]: value }));
      }}
      remaining={remaining}
      completionError={null}
      ambiguous={false}
      storageError={false}
      ready
      onSubmit={() => undefined}
    />
  );
}

describe('SalePaymentStep', () => {
  afterEach(() => cleanup());

  it('exposes one amount field driven by the selected method, not four method boxes', () => {
    render(<PaymentHarness />);

    expect(screen.getByLabelText('طريقة الدفع')).toBeDefined();
    expect(screen.getByLabelText('المبلغ')).toBeDefined();
    for (const { label } of paymentMethods) {
      expect(screen.queryByLabelText(label)).toBeNull();
    }
  });

  it('keeps cash when visa is entered next so the invoice can mix methods', () => {
    const onPaymentChange = vi.fn();
    render(
      <SalePaymentStep
        blockers={[]}
        hasLines
        quotePending={false}
        quoteIsError={false}
        quoteError={null}
        quoteData={quote}
        onRecalculateQuote={() => undefined}
        onRemoveServices={() => undefined}
        payments={{ cash: '200.00', visa: '', instapay: '', vodafone_cash: '' }}
        onPaymentChange={onPaymentChange}
        remaining={BigInt(30000)}
        completionError={null}
        ambiguous={false}
        storageError={false}
        ready
        onSubmit={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText('طريقة الدفع'), { target: { value: 'visa' } });
    fireEvent.change(screen.getByLabelText('المبلغ'), { target: { value: '100.00' } });

    expect(onPaymentChange).toHaveBeenCalledWith('visa', '100.00');
    expect(onPaymentChange).not.toHaveBeenCalledWith('cash', expect.anything());
    expect(within(screen.getByLabelText('المدفوعات المسجلة')).getByText('نقدي')).toBeDefined();
    expect(within(screen.getByLabelText('المدفوعات المسجلة')).getByText('200.00 ج.م')).toBeDefined();
  });

  it('treats cash 200 plus visa 100 on a 500 invoice as 200 remaining', () => {
    render(
      <PaymentHarness
        initial={{ cash: '200.00', visa: '100.00', instapay: '', vodafone_cash: '' }}
        remaining={BigInt(20000)}
      />,
    );

    expect(screen.getByText('المتبقي 200.00 ج.م')).toBeDefined();
    const recorded = screen.getByLabelText('المدفوعات المسجلة');
    expect(within(recorded).getByText('نقدي')).toBeDefined();
    expect(within(recorded).getByText('فيزا')).toBeDefined();
  });
});
