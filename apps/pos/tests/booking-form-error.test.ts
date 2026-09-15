import { describe, expect, test } from 'vitest';

import { mapBookingSaveError } from '../src/features/bookings/components/booking-form';

describe('mapBookingSaveError', () => {
  test('maps the known Invalid Cairo local time error to Arabic', () => {
    const mapped = mapBookingSaveError(new Error('Invalid Cairo local time')) as Error;

    expect(mapped).toBeInstanceOf(Error);
    expect(mapped.message).toBe('الوقت المحلي غير صالح.');
  });

  test('preserves all other errors unchanged', () => {
    const other = new Error('شبكة.');
    expect(mapBookingSaveError(other)).toBe(other);
    expect(mapBookingSaveError(null)).toBeNull();
  });
});
