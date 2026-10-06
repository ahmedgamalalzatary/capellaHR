import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';

import { erpBookingServices, erpBookings } from '../../../../src/schema/erp/bookings/index.js';

describe('ERP booking schema', () => {
  it('stores the guarded booking lifecycle without a single-invoice column', () => {
    const config = getTableConfig(erpBookings);
    expect(config.columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'branch_id', 'client_id', 'scheduled_at', 'status', 'note',
      'acting_account_id', 'created_at', 'updated_at',
    ]));
    expect(config.columns.map((column) => column.name)).not.toContain('invoice_id');
    expect(config.indexes.map((index) => index.config.name)).toEqual(expect.arrayContaining([
      'erp_bookings_branch_scheduled_idx',
    ]));
    expect(config.indexes.map((index) => index.config.name))
      .not.toContain('erp_bookings_invoice_unique');
    expect(config.foreignKeys.map((foreignKey) => foreignKey.getName()))
      .not.toContain('erp_bookings_invoice_branch_fk');
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

  it('tracks each service lifecycle with the invoice that sold it', () => {
    const config = getTableConfig(erpBookingServices);
    const columnsByName = Object.fromEntries(
      config.columns.map((column) => [column.name, column]),
    );
    const status = columnsByName['status']!;
    expect(status).toBeDefined();
    expect(status.columnType).toBe('MySqlEnumColumn');
    expect((status as unknown as { enumValues: string[] }).enumValues)
      .toEqual(['pending', 'sold', 'cancelled']);
    expect(status.default).toBe('pending');
    expect(status.notNull).toBe(true);
    expect(columnsByName['invoice_id']!).toBeDefined();
    expect(columnsByName['invoice_line_id']!).toBeDefined();
    expect(columnsByName['changed_at']!).toBeDefined();
    expect(columnsByName['invoice_id']!.notNull).toBe(false);
    expect(columnsByName['invoice_line_id']!.notNull).toBe(false);
    expect(columnsByName['changed_at']!.notNull).toBe(false);

    expect(config.indexes.map((index) => index.config.name)).toEqual(expect.arrayContaining([
      'erp_booking_services_invoice_line_unique',
    ]));
    expect(config.foreignKeys.map((foreignKey) => foreignKey.getName())).toEqual(
      expect.arrayContaining([
        'erp_booking_services_invoice_branch_fk',
        'erp_booking_services_invoice_line_fk',
      ]),
    );
    expect(config.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining(['erp_booking_services_sold_invoice_pair']),
    );
  });
});
