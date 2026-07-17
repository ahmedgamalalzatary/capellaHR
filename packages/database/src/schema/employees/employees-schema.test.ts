import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';

import { employeeCodeSequence, employeeImages, employees } from './index.js';

describe('employee schema', () => {
  it('stores immutable identity, payroll/shift foundation and soft deletion', () => {
    expect(Object.keys(getTableColumns(employees))).toEqual(expect.arrayContaining([
      'id', 'employeeCode', 'fullName', 'personalPhone', 'whatsappPhone', 'pinHash', 'age',
      'address', 'branchId', 'shiftDurationMinutes', 'monthlyBaseSalary', 'deletedAt',
    ]));
    expect(getTableConfig(employees).indexes.some((index) => index.config.name === 'employees_employee_code_unique')).toBe(true);
  });

  it('stores private image metadata and a singleton code allocator', () => {
    expect(Object.keys(getTableColumns(employeeImages))).toEqual(expect.arrayContaining(['employeeId', 'kind', 'storagePath', 'mimeType', 'sizeBytes']));
    expect(Object.keys(getTableColumns(employeeCodeSequence))).toContain('nextCode');
  });

  it('enforces critical numeric invariants in MySQL', () => {
    const checks = getTableConfig(employees).checks.map((item) => item.name);
    expect(checks).toEqual(expect.arrayContaining(['employees_age_positive', 'employees_shift_duration_range', 'employees_salary_positive']));
  });
});
