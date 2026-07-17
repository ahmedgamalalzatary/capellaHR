import { describe, expect, it } from 'vitest';

import { createEmployeeFieldsSchema, listEmployeesQuerySchema, updateEmployeeFieldsSchema } from './index.js';

const valid = {
  fullName: 'أحمد محمد', personalPhone: '010 1234 5678', whatsappPhone: '01012345678',
  pin: '1234', age: 30, address: 'القاهرة', branchId: 1,
  shiftDurationMinutes: 600, monthlyBaseSalary: '5000.00',
};

describe('employee contracts', () => {
  it('normalizes valid creation fields', () => {
    expect(createEmployeeFieldsSchema.parse(valid)).toMatchObject({ personalPhone: '01012345678', shiftDurationMinutes: 600 });
  });

  it.each([
    ['pin', { pin: '12345' }], ['age', { age: 0 }], ['shift', { shiftDurationMinutes: 0 }],
    ['shift maximum', { shiftDurationMinutes: 721 }], ['salary', { monthlyBaseSalary: '1.001' }],
    ['phone', { personalPhone: '01312345678' }],
  ])('rejects invalid %s', (_name, change) => expect(() => createEmployeeFieldsSchema.parse({ ...valid, ...change })).toThrow());

  it('accepts exactly twelve hours', () => expect(createEmployeeFieldsSchema.parse({ ...valid, shiftDurationMinutes: 720 }).shiftDurationMinutes).toBe(720));

  it('does not permit branch or code updates', () => {
    expect(() => updateEmployeeFieldsSchema.parse({ branchId: 2 })).toThrow();
    expect(() => updateEmployeeFieldsSchema.parse({ employeeCode: 10 })).toThrow();
    expect(() => updateEmployeeFieldsSchema.parse({ monthlyBaseSalary: '6000.00' })).toThrow();
  });

  it('parses employee list filters', () => {
    expect(listEmployeesQuerySchema.parse({ branchId: '2', page: '2' })).toMatchObject({ branchId: 2, page: 2, pageSize: 20 });
  });
});
