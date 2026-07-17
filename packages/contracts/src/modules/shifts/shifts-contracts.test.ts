import { describe, expect, it } from 'vitest';

import {
  listShiftAssignmentsQuerySchema,
  shiftEmployeeParamsSchema,
  updateShiftAssignmentSchema,
} from './index.js';

describe('shift contracts', () => {
  it.each([1, 720])('accepts a duration of %i minutes', (durationMinutes) => {
    expect(updateShiftAssignmentSchema.parse({ durationMinutes })).toEqual({ durationMinutes });
  });

  it.each([0, 721, 1.5])('rejects an invalid duration of %s minutes', (durationMinutes) => {
    expect(() => updateShiftAssignmentSchema.parse({ durationMinutes })).toThrow();
  });

  it('rejects unknown update fields', () => {
    expect(() => updateShiftAssignmentSchema.parse({ durationMinutes: 600, name: 'Morning' })).toThrow();
  });

  it.each([true, false, '600', [1]])('rejects a non-numeric JSON duration value of %s', (durationMinutes) => {
    expect(() => updateShiftAssignmentSchema.parse({ durationMinutes })).toThrow();
  });

  it('parses a positive employee id', () => {
    expect(shiftEmployeeParamsSchema.parse({ employeeId: '42' })).toEqual({ employeeId: 42 });
    expect(() => shiftEmployeeParamsSchema.parse({ employeeId: '0' })).toThrow();
  });

  it('trims search and parses branch and pagination filters', () => {
    expect(listShiftAssignmentsQuerySchema.parse({
      search: '  42  ', branchId: '3', page: '2', pageSize: '25',
    })).toEqual({ search: '42', branchId: 3, page: 2, pageSize: 25 });
  });

  it('applies pagination defaults and rejects blank search', () => {
    expect(listShiftAssignmentsQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(() => listShiftAssignmentsQuerySchema.parse({ search: '   ' })).toThrow();
  });

  it.each(['2147483648', '1e308'])('rejects page %s before it can produce an unsafe SQL offset', (page) => {
    expect(() => listShiftAssignmentsQuerySchema.parse({ page })).toThrow();
  });
});
