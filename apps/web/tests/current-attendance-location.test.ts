import { describe, expect, it, vi } from 'vitest';

import { currentAttendanceLocation } from '@/features/attendance/lib/current-location';

describe('currentAttendanceLocation', () => {
  it('requests a recent high-accuracy location with a 30-second timeout', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: 30, longitude: 31, accuracy: 12 },
      } as GeolocationPosition);
    });
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: { getCurrentPosition },
    });

    await expect(currentAttendanceLocation()).resolves.toEqual({
      latitude: 30,
      longitude: 31,
      gpsAccuracyMeters: 12,
    });
    expect(getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 30_000 },
    );

    vi.unstubAllGlobals();
  });
});
