import { describe, expect, it } from 'vitest';

import { createBranchSchema, listBranchesQuerySchema, updateBranchSchema } from './index.js';

const branch = {
  name: '  Cairo  ',
  location: 'Nasr City',
  latitude: 30.0561,
  longitude: 31.3301,
  gpsAccuracyMeters: 8,
  attendanceRadiusMeters: 50,
};

describe('branch contracts', () => {
  it('accepts a complete captured branch location and trims text', () => {
    expect(createBranchSchema.parse(branch)).toMatchObject({ name: 'Cairo', location: 'Nasr City' });
  });

  it('rejects invalid coordinates, accuracy, and radius', () => {
    expect(createBranchSchema.safeParse({ ...branch, latitude: 91 }).success).toBe(false);
    expect(createBranchSchema.safeParse({ ...branch, gpsAccuracyMeters: -1 }).success).toBe(false);
    expect(createBranchSchema.safeParse({ ...branch, attendanceRadiusMeters: 0 }).success).toBe(false);
  });

  it('rejects names whose lowercased form exceeds the 255-character column limit', () => {
    // U+0130 lowercases to two code units, so 255 of them normalize to 510.
    const expandingName = 'İ'.repeat(255);
    expect(expandingName.length).toBe(255);
    expect(createBranchSchema.safeParse({ ...branch, name: expandingName }).success).toBe(false);
    expect(updateBranchSchema.safeParse({ name: expandingName }).success).toBe(false);
  });

  it('requires a full GPS reading when any coordinate is updated', () => {
    expect(updateBranchSchema.safeParse({ latitude: 30 }).success).toBe(false);
    expect(updateBranchSchema.safeParse({ latitude: 30, longitude: 31, gpsAccuracyMeters: 4 }).success).toBe(true);
  });

  it('normalizes list pagination defaults', () => {
    expect(listBranchesQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });
});
