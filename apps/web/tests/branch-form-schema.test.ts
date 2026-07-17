import { describe, expect, test } from 'vitest';

import { branchFormSchema } from '../src/features/branches/schemas/branch-form';

const valid = {
  name: 'فرع القاهرة',
  location: 'مدينة نصر',
  latitude: '30.05',
  longitude: '31.33',
  gpsAccuracyMeters: '8',
  attendanceRadiusMeters: '50',
};

describe('branchFormSchema', () => {
  test('coerces numeric strings', () => {
    const parsed = branchFormSchema.parse(valid);
    expect(parsed.latitude).toBe(30.05);
    expect(parsed.attendanceRadiusMeters).toBe(50);
  });

  test('rejects whitespace-only numeric fields instead of coercing them to zero', () => {
    expect(branchFormSchema.safeParse({ ...valid, latitude: '   ' }).success).toBe(false);
    expect(branchFormSchema.safeParse({ ...valid, longitude: '\t' }).success).toBe(false);
    expect(branchFormSchema.safeParse({ ...valid, gpsAccuracyMeters: ' ' }).success).toBe(false);
  });

  test('still rejects empty required numbers', () => {
    expect(branchFormSchema.safeParse({ ...valid, latitude: '' }).success).toBe(false);
  });
});
