import { createDatabase } from '@capella/database';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Migration 0115 gave every booked service a lifecycle of its own, leaving every
 * row that already existed on the default. Migration 0117 settles the ones that
 * were really finished: these tests stop the migrations at 0114, write bookings
 * the old way, and let 0115 and 0117 decide each service's status.
 */
const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/database/migrations',
);
const journal = JSON.parse(readFileSync(
  path.join(migrationsDirectory, 'meta/_journal.json'),
  'utf8',
)) as { entries: Array<{ tag: string }> };

const control = createDatabase(process.env.DATABASE_URL ?? '');
const databaseName = `capella_hr_test_booking_backfill_${process.pid}_${Date.now()}`;
const url = new URL(process.env.DATABASE_URL ?? '');
url.pathname = `/${databaseName}`;
const database = createDatabase(url.toString());

/** Applies the migrations whose tag matches, in journal order. */
const applyMigrations = async (matches: (tag: string) => boolean) => {
  for (const { tag } of journal.entries) {
    if (!matches(tag)) continue;
    const file = readFileSync(path.join(migrationsDirectory, `${tag}.sql`), 'utf8');
    for (const statement of file.split('--> statement-breakpoint')) {
      const trimmed = statement.trim().replace(/;$/, '');
      if (trimmed.length > 0) await database.execute(sql.raw(trimmed));
    }
  }
};

const at = new Date('2026-08-24T08:00:00.000Z');
const ids = {
  branchId: 0,
  accountId: 0,
  clientId: 0,
  categoryId: 0,
  serviceId: 0,
  otherServiceId: 0,
  cancelled: 0,
  noShow: 0,
  booked: 0,
};

const legacyBooking = async (status: 'booked' | 'cancelled' | 'no_show') => {
  const bookingId = Number((await database.execute(sql`
    INSERT INTO erp_bookings
      (branch_id, client_id, scheduled_at, status, acting_account_id, created_at, updated_at)
    VALUES (${ids.branchId}, ${ids.clientId}, ${at}, ${status}, ${ids.accountId}, ${at}, ${at})
  `))[0].insertId);
  await database.execute(sql`
    INSERT INTO erp_booking_services (booking_id, branch_id, service_id)
    VALUES (${bookingId}, ${ids.branchId}, ${ids.serviceId}),
      (${bookingId}, ${ids.branchId}, ${ids.otherServiceId})
  `);
  return bookingId;
};

const statusesOf = async (bookingId: number) => {
  const [rows] = await database.$client.promise().query(
    'SELECT status FROM erp_booking_services WHERE booking_id = ? ORDER BY id',
    [bookingId],
  ) as [Array<{ status: string }>, unknown];
  return rows.map((row) => row.status);
};

beforeAll(async () => {
  if (!/^capella_hr_test_booking_backfill_\d+_\d+$/.test(databaseName)) {
    throw new Error('Unsafe booking backfill database name');
  }
  await control.execute(sql.raw(
    `CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  ));
  // Everything the booking tables needed before their services gained a status.
  await applyMigrations((tag) => Number(tag.slice(0, 4)) <= 114);
  // 0116 is the index that landed with it and carries no data of its own.

  const marker = `${process.pid}`;
  ids.branchId = Number((await database.execute(sql`
    INSERT INTO branches
      (name, name_normalized, location, latitude, longitude, gps_accuracy_meters,
       attendance_radius_meters, created_at, updated_at)
    VALUES (${`Booking backfill ${marker}`}, ${`booking-backfill-${marker}`}, 'Cairo', 30, 31, 5, 50,
      ${at}, ${at})
  `))[0].insertId);
  ids.accountId = Number((await database.execute(sql`
    INSERT INTO accounts (username, password_hash, role, created_at, updated_at)
    VALUES (${`booking-backfill-admin-${marker}`}, 'test-only', 'admin', ${at}, ${at})
  `))[0].insertId);
  ids.clientId = Number((await database.execute(sql`
    INSERT INTO clients (branch_id, full_name, phone, created_at, updated_at)
    VALUES (${ids.branchId}, ${'منى أحمد'}, ${'01000000001'}, ${at}, ${at})
  `))[0].insertId);
  ids.categoryId = Number((await database.execute(sql`
    INSERT INTO erp_categories (branch_id, type, name, name_normalized, created_at, updated_at)
    VALUES (${ids.branchId}, 'service', ${'Hair'}, ${`hair-${marker}`}, ${at}, ${at})
  `))[0].insertId);
  ids.serviceId = Number((await database.execute(sql`
    INSERT INTO erp_services (branch_id, category_id, name, name_normalized, price,
      commission_percent, created_at, updated_at)
    VALUES (${ids.branchId}, ${ids.categoryId}, ${'Colour'}, ${`colour-${marker}`}, ${'200.00'},
      ${'10.00'}, ${at}, ${at})
  `))[0].insertId);
  ids.otherServiceId = Number((await database.execute(sql`
    INSERT INTO erp_services (branch_id, category_id, name, name_normalized, price,
      commission_percent, created_at, updated_at)
    VALUES (${ids.branchId}, ${ids.categoryId}, ${'Cut'}, ${`cut-${marker}`}, ${'100.00'},
      ${'10.00'}, ${at}, ${at})
  `))[0].insertId);

  ids.cancelled = await legacyBooking('cancelled');
  ids.noShow = await legacyBooking('no_show');
  ids.booked = await legacyBooking('booked');

  await applyMigrations((tag) => Number(tag.slice(0, 4)) >= 115);
}, 300_000);

afterAll(async () => {
  await database.$client.promise().end();
  await control.execute(sql.raw(`DROP DATABASE IF EXISTS \`${databaseName}\``));
  await control.$client.promise().end();
}, 30_000);

describe('ERP booking service status backfill', () => {
  it('settles the services of a cancelled booking as cancelled', async () => {
    expect(await statusesOf(ids.cancelled)).toEqual(['cancelled', 'cancelled']);
  });

  it('settles the services of a no-show booking as cancelled', async () => {
    expect(await statusesOf(ids.noShow)).toEqual(['cancelled', 'cancelled']);
  });

  it('leaves the services of a booking that is still ahead waiting', async () => {
    expect(await statusesOf(ids.booked)).toEqual(['pending', 'pending']);
  });
});