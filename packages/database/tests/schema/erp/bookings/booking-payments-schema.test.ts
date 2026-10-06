import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';

import { erpBookingPayments } from '../../../../src/schema/erp/bookings/index.js';

describe('ERP booking payments schema', () => {
  it('is a booking money ledger with payments and cause-tagged refunds', () => {
    const config = getTableConfig(erpBookingPayments);
    expect(config.columns.map((column) => column.name)).toEqual([
      'id', 'booking_id', 'branch_id', 'kind', 'method', 'amount', 'refund_cause',
      'cashier_session_id', 'acting_account_id', 'operation_reference', 'created_at',
    ]);

    const columnsByName = Object.fromEntries(config.columns.map((column) => [column.name, column]));
    const kind = columnsByName['kind'] as unknown as { enumValues: string[]; notNull: boolean };
    expect(kind.enumValues).toEqual(['payment', 'refund']);
    expect(kind.notNull).toBe(true);
    const method = columnsByName['method'] as unknown as { enumValues: string[]; notNull: boolean };
    expect(method.enumValues).toEqual(['cash', 'visa', 'instapay', 'vodafone_cash']);
    expect(method.notNull).toBe(true);
    const refundCause = columnsByName['refund_cause'] as unknown as { enumValues: string[]; notNull: boolean };
    expect(refundCause.enumValues).toEqual([
      'service_cancelled', 'booking_cancelled', 'no_show', 'checkout_excess',
    ]);
    expect(refundCause.notNull).toBe(false);
    expect(columnsByName['amount']!.notNull).toBe(true);
    expect(columnsByName['cashier_session_id']!.notNull).toBe(true);
    expect(columnsByName['acting_account_id']!.notNull).toBe(true);
    expect(columnsByName['operation_reference']!.notNull).toBe(true);
    expect(columnsByName['created_at']!.notNull).toBe(true);
  });

  it('scopes references to the booking branch and dedupes operations', () => {
    const config = getTableConfig(erpBookingPayments);
    expect(config.foreignKeys.map((foreignKey) => foreignKey.getName())).toEqual(
      expect.arrayContaining([
        'erp_booking_payments_booking_branch_fk',
        'erp_booking_payments_session_branch_fk',
        'erp_booking_payments_account_fk',
      ]),
    );
    expect(config.indexes.map((index) => index.config.name)).toEqual(expect.arrayContaining([
      'erp_booking_payments_booking_reference_unique',
      'erp_booking_payments_session_created_idx',
      'erp_booking_payments_branch_created_idx',
    ]));
    expect(config.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      'erp_booking_payments_amount_positive',
      'erp_booking_payments_refund_cause',
    ]));
  });
});
