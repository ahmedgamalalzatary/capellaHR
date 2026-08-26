import { describe, expect, it } from 'vitest';

import { cairoDateTimeToIso } from '../src/features/bookings/components/booking-form';

describe('Cairo booking wall-time conversion', () => {
  it('preserves valid local times across the spring DST boundary', () => {
    expect(cairoDateTimeToIso('2026-04-23T23:30')).toBe('2026-04-23T21:30:00.000Z');
  });

  it('rejects a local time skipped by the spring DST transition', () => {
    expect(cairoDateTimeToIso('2026-04-24T00:30')).toBeNull();
  });

  it('chooses the earlier instant when the autumn rollback repeats a local time', () => {
    expect(cairoDateTimeToIso('2026-10-29T23:30')).toBe('2026-10-29T20:30:00.000Z');
  });
});
