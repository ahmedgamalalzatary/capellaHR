import { describe, expect, it } from 'vitest';

import {
  createEmployeeFieldsSchema,
  employeeDeactivationSchema,
  listEmployeesQuerySchema,
  updateEmployeeFieldsSchema,
} from '../../../src/modules/employees/index.js';

const valid = {
  fullName: 'أحمد محمد', personalPhone: '010 1234 5678', whatsappPhone: '01012345678',
  pin: '1234', age: 30, address: 'القاهرة', branchId: 1,
  shiftDurationMinutes: 600, monthlyBaseSalary: '5000.00',
};

describe('employee contracts', () => {
  it('normalizes valid creation fields', () => {
    expect(createEmployeeFieldsSchema.parse(valid)).toMatchObject({ personalPhone: '01012345678', shiftDurationMinutes: 600 });
  });

  it('rejects Arabic-Indic phone digits with a Western-digit instruction', () => {
    const result = createEmployeeFieldsSchema.safeParse({
      ...valid,
      personalPhone: '٠١٠١٢٣٤٥٦٧٨',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('استخدم الأرقام الإنجليزية من 0 إلى 9');
  });

  it.each([
    ['pin', { pin: '12345' }], ['age', { age: 0 }], ['shift', { shiftDurationMinutes: 0 }],
    ['shift maximum', { shiftDurationMinutes: 721 }], ['salary', { monthlyBaseSalary: '1.001' }],
    ['phone', { personalPhone: '01312345678' }],
  ])('rejects invalid %s', (_name, change) => expect(() => createEmployeeFieldsSchema.parse({ ...valid, ...change })).toThrow());

  it('accepts exactly twelve hours', () => expect(createEmployeeFieldsSchema.parse({ ...valid, shiftDurationMinutes: 720 }).shiftDurationMinutes).toBe(720));

  it('coerces the shift duration received from multipart employee forms', () => {
    expect(createEmployeeFieldsSchema.parse({
      ...valid,
      shiftDurationMinutes: '600',
    }).shiftDurationMinutes).toBe(600);
  });

  it('accepts decimal integer strings from multipart forms without coercing other JSON types', () => {
    expect(createEmployeeFieldsSchema.parse({ ...valid, age: '30', branchId: '1' }))
      .toMatchObject({ age: 30, branchId: 1 });
    expect(updateEmployeeFieldsSchema.safeParse({ age: true }).success).toBe(false);
    expect(updateEmployeeFieldsSchema.safeParse({ age: [30] }).success).toBe(false);
  });

  it('permits branch updates but not employee code or salary updates', () => {
    expect(updateEmployeeFieldsSchema.parse({ branchId: '2' })).toEqual({ branchId: 2 });
    expect(() => updateEmployeeFieldsSchema.parse({ employeeCode: 10 })).toThrow();
    expect(() => updateEmployeeFieldsSchema.parse({ monthlyBaseSalary: '6000.00' })).toThrow();
  });

  it('parses employee list filters', () => {
    expect(listEmployeesQuerySchema.parse({ branchId: '2', status: 'inactive', page: '2' }))
      .toMatchObject({ branchId: 2, status: 'inactive', page: 2, pageSize: 20 });
  });

  it('carries the advance decision and the negative-balance decision for deactivation', () => {
    const decisions = {
      advanceDecision: 'sum_all',
      negativeBalanceDecision: 'record_debt',
      expectedUnpaidInstallmentCount: 3,
      expectedUnpaidAdvanceAmount: '3000.00',
      expectedProjectedNetSalary: '-1000.00',
      expectedAmountOwed: '1000.00',
    };
    expect(employeeDeactivationSchema.parse(decisions)).toEqual(decisions);
    expect(employeeDeactivationSchema.safeParse({}).success).toBe(false);
  });

  it.each(['zero_salary', 'ignore_debt'] as const)('accepts %s without a negative-balance decision', (advanceDecision) => {
    // Both terminate the flow at modal 2: the balance is settled by the decision itself, so
    // there is no shortfall left for modal 3 to resolve.
    expect(employeeDeactivationSchema.parse({
      advanceDecision,
      expectedUnpaidInstallmentCount: 3,
      expectedUnpaidAdvanceAmount: '3000.00',
      expectedProjectedNetSalary: '-1000.00',
      expectedAmountOwed: '1000.00',
    })).toMatchObject({ advanceDecision });
  });

  it('rejects decisions that are no longer part of the deactivation flow', () => {
    const base = {
      expectedUnpaidInstallmentCount: 0,
      expectedUnpaidAdvanceAmount: '0.00',
      expectedProjectedNetSalary: '0.00',
      expectedAmountOwed: '0.00',
    };
    expect(employeeDeactivationSchema.safeParse({ ...base, advanceDecision: 'accelerate' }).success).toBe(false);
    expect(employeeDeactivationSchema.safeParse({
      ...base, advanceDecision: 'sum_all', negativeBalanceDecision: 'keep_debt',
    }).success).toBe(false);
    expect(employeeDeactivationSchema.safeParse({
      ...base, advanceDecision: 'sum_all', negativeBalanceDecision: 'paid',
    }).success).toBe(false);
  });

  it('rejects filters outside safe MySQL and pagination ranges', () => {
    expect(listEmployeesQuerySchema.safeParse({ branchId: '2147483648' }).success).toBe(false);
    expect(listEmployeesQuerySchema.safeParse({ page: '1e308' }).success).toBe(false);
  });
});
