import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';

import { attendanceDailyRecords } from './index.js';

describe('attendance daily-record schema', () => {
  it('stores the absence snapshot and reversible weekly day-off state', () => {
    expect(Object.keys(getTableColumns(attendanceDailyRecords))).toEqual(expect.arrayContaining([
      'id', 'employeeId', 'attendanceDate', 'status', 'absenceRequiredMinutes',
      'dayOffConvertedAt', 'createdAt', 'updatedAt',
    ]));
  });

  it('enforces one record per employee/date and a valid duration snapshot', () => {
    const config = getTableConfig(attendanceDailyRecords);
    expect(config.indexes.some((index) => (
      index.config.name === 'attendance_daily_records_employee_date_unique'
    ))).toBe(true);
    expect(config.checks.map((item) => item.name)).toContain(
      'attendance_daily_records_required_minutes_range',
    );
  });
});
