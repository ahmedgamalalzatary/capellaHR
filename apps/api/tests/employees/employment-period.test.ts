import { describe, expect, it, vi } from 'vitest';

import { employmentDateIsActive, employmentMonthIsActive } from '../../src/modules/employees/employment-period.js';

describe('employment periods', () => {
  const periods = [
    { activeFrom: new Date('2026-07-01T08:00:00.000Z'), activeTo: new Date('2026-07-10T10:00:00.000Z') },
    { activeFrom: new Date('2026-07-21T08:00:00.000Z'), activeTo: null },
  ];

  it('includes activation and deactivation calendar days', () => {
    expect(employmentDateIsActive('2026-07-01', periods, 'Africa/Cairo')).toBe(true);
    expect(employmentDateIsActive('2026-07-10', periods, 'Africa/Cairo')).toBe(true);
  });

  it('excludes the inactive gap and resumes on reactivation day', () => {
    expect(employmentDateIsActive('2026-07-15', periods, 'Africa/Cairo')).toBe(false);
    expect(employmentDateIsActive('2026-07-21', periods, 'Africa/Cairo')).toBe(true);
  });

  it('includes only payroll months overlapping an active period', () => {
    const separatedPeriods = [
      { activeFrom: new Date('2026-07-01T08:00:00.000Z'), activeTo: new Date('2026-07-10T10:00:00.000Z') },
      { activeFrom: new Date('2026-09-01T08:00:00.000Z'), activeTo: null },
    ];
    expect(employmentMonthIsActive('2026-07', separatedPeriods, 'Africa/Cairo')).toBe(true);
    expect(employmentMonthIsActive('2026-08', separatedPeriods, 'Africa/Cairo')).toBe(false);
    expect(employmentMonthIsActive('2026-09', separatedPeriods, 'Africa/Cairo')).toBe(true);
  });

  it('builds sortable calendar keys from localized date parts', () => {
    const formatToParts = vi.fn(() => [
      { type: 'day', value: '1' },
      { type: 'literal', value: '/' },
      { type: 'month', value: '7' },
      { type: 'literal', value: '/' },
      { type: 'year', value: '26' },
    ]);
    vi.stubGlobal('Intl', {
      ...Intl,
      DateTimeFormat: vi.fn(() => ({
        format: () => '1/7/26',
        formatToParts,
      })),
    });

    try {
      expect(employmentDateIsActive('0026-07-01', [
        { activeFrom: new Date('2026-07-01T08:00:00.000Z'), activeTo: null },
      ], 'Africa/Cairo')).toBe(true);
      expect(formatToParts).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
