import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';

import { erpBookingServices, erpBookings } from '../../../../src/schema/erp/bookings/index.js';

describe('ERP booking schema', () => {
  it('stores the guarded booking lifecycle and one converted invoice', () => {
    const config = getTableConfig(erpBookings);
    expect(config.columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'branch_id', 'client_id', 'scheduled_at', 'status', 'note',
      'acting_account_id', 'invoice_id', 'created_at', 'updated_at',
    ]));
    expect(config.indexes.map((index) => index.config.name)).toEqual(expect.arrayContaining([
      'erp_bookings_invoice_unique',
      'erp_bookings_branch_scheduled_idx',
    ]));
  });

  it('keeps each service once and indexes future preferred-employee work', () => {
    const config = getTableConfig(erpBookingServices);
    expect(config.indexes.map((index) => index.config.name)).toEqual(expect.arrayContaining([
      'erp_booking_services_booking_service_unique',
      'erp_booking_services_preferred_employee_idx',
    ]));
    expect(config.foreignKeys.map((foreignKey) => foreignKey.getName())).toEqual(
      expect.arrayContaining([
        'erp_booking_services_booking_branch_fk',
        'erp_booking_services_service_branch_fk',
      ]),
    );
  });
});
