import { describe, expect, it } from 'vitest';
import { listDevicesQuerySchema } from './index.js';

describe('device contracts', () => {
  it('requires an assignment type when filtering by assignment id', () => {
    expect(listDevicesQuerySchema.safeParse({ assignmentId: '12' }).success).toBe(false);
    expect(listDevicesQuerySchema.safeParse({ assignmentType: 'branch', assignmentId: '12' }).success).toBe(true);
  });
});
