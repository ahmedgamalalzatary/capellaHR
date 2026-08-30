'use client';

import type { PaymentMethod, QuoteSaleInput } from '@capella/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import { quoteSale } from '../api/sales-api';
import { salesQueryKeys } from '../query-keys';

import { type AdjustmentKind, type Line } from './sale-primitives';

/**
 * Owns the server-priced quote for the current basket, and seeds the cash
 * payment with the quoted total until the counter edits a payment by hand.
 */
export function useSaleQuote({
  branchId,
  lines,
  discountKind,
  discountValue,
  taxKind,
  taxValue,
  servicePricesValid,
  paymentsTouched,
  setPayments,
}: {
  branchId?: number;
  lines: Line[];
  discountKind: AdjustmentKind;
  discountValue: string;
  taxKind: AdjustmentKind;
  taxValue: string;
  servicePricesValid: boolean;
  paymentsTouched: boolean;
  setPayments: (update: (current: Record<PaymentMethod, string>) => Record<PaymentMethod, string>) => void;
}) {
  const quoteInput = useMemo<QuoteSaleInput>(() => ({
    ...(branchId === undefined ? {} : { branchId }),
    lines: lines.map(({ service, quantity, unitPrice, itemType }) => itemType === 'product'
      ? { itemType: 'product' as const, productId: service.id, quantity }
      : { itemType: 'service' as const, serviceId: service.id, quantity, unitPrice }),
    ...(discountValue ? { discount: { kind: discountKind, value: discountValue } } : {}),
    ...(taxValue ? { tax: { kind: taxKind, value: taxValue } } : {}),
  }), [branchId, discountKind, discountValue, lines, taxKind, taxValue]);

  const quote = useQuery({
    queryKey: salesQueryKeys.quote(quoteInput),
    queryFn: () => quoteSale(quoteInput),
    enabled: lines.length > 0 && servicePricesValid,
  });

  useEffect(() => {
    if (quote.data && !paymentsTouched) {
      setPayments((current) => ({ ...current, cash: quote.data!.totals.total }));
    }
  }, [paymentsTouched, quote.data, setPayments]);

  return { quoteInput, quote };
}
