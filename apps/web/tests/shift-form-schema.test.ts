import { describe, expect, test } from 'vitest';

import {
  shiftFormSchema,
  splitDuration,
} from '../src/features/shifts/schemas/shift-form';

describe('shiftFormSchema', () => {
  test('combines hours and minutes into whole minutes', () => {
    expect(shiftFormSchema.parse({ hours: '8', minutes: '30' })).toEqual({ durationMinutes: 510 });
    expect(shiftFormSchema.parse({ hours: '0', minutes: '45' })).toEqual({ durationMinutes: 45 });
  });

  test('accepts the locked boundaries of one minute and twelve hours', () => {
    expect(shiftFormSchema.parse({ hours: '0', minutes: '1' })).toEqual({ durationMinutes: 1 });
    expect(shiftFormSchema.parse({ hours: '12', minutes: '0' })).toEqual({ durationMinutes: 720 });
  });

  test('leaves the minimum total-duration rule to the API', () => {
    expect(shiftFormSchema.parse({ hours: '0', minutes: '0' })).toEqual({
      durationMinutes: 0,
    });
  });

  test('leaves the maximum total-duration rule to the API', () => {
    expect(shiftFormSchema.parse({ hours: '12', minutes: '30' })).toEqual({
      durationMinutes: 750,
    });
  });

  test('rejects minutes outside a single hour', () => {
    expect(shiftFormSchema.safeParse({ hours: '1', minutes: '60' }).success).toBe(false);
    expect(shiftFormSchema.safeParse({ hours: '1', minutes: '-1' }).success).toBe(false);
  });

  test('rejects empty, whitespace-only, and fractional input', () => {
    expect(shiftFormSchema.safeParse({ hours: '', minutes: '30' }).success).toBe(false);
    expect(shiftFormSchema.safeParse({ hours: '   ', minutes: '30' }).success).toBe(false);
    expect(shiftFormSchema.safeParse({ hours: '8', minutes: '' }).success).toBe(false);
    expect(shiftFormSchema.safeParse({ hours: '8.5', minutes: '0' }).success).toBe(false);
  });
});

describe('splitDuration', () => {
  test('splits stored minutes back into hours and minutes', () => {
    expect(splitDuration(510)).toEqual({ hours: 8, minutes: 30 });
    expect(splitDuration(720)).toEqual({ hours: 12, minutes: 0 });
    expect(splitDuration(1)).toEqual({ hours: 0, minutes: 1 });
  });
});
