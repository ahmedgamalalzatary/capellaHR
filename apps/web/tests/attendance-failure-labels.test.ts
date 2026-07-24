import { describe, expect, it } from 'vitest';

import { FACE_FAILURE_LABELS } from '../src/features/attendance/lib/failure-labels';

describe('face failure labels', () => {
  it('exports all five attendance face failures', () => {
    expect(Object.keys(FACE_FAILURE_LABELS)).toEqual([
      'FACE_MISMATCH', 'FACE_NOT_FOUND', 'MULTIPLE_FACES', 'FACE_IMAGE_INVALID', 'FACE_COMPARISON_FAILED',
    ]);
  });
});
