import { afterEach, expect, it, vi } from 'vitest';

import { recordEmployeeAttendance } from '../src/features/attendance/api/attendance-api';

afterEach(() => vi.unstubAllGlobals());

it('submits attendance payload and camera image as multipart form data', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { id: 1 } }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  })));
  const faceImage = new File(['camera-frame'], 'face.jpg', { type: 'image/jpeg' });
  const payload = {
    employeeCode: 42, pin: '1234', source: 'personal_device' as const,
    latitude: 30, longitude: 31, gpsAccuracyMeters: 8,
    installationMarker: 'installation-marker-123', faceImage,
  };

  await recordEmployeeAttendance('check_in', payload);

  const options = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
  expect(options.body).toBeInstanceOf(FormData);
  const form = options.body as FormData;
  expect(JSON.parse(String(form.get('payload')))).toEqual({
    employeeCode: 42, pin: '1234', source: 'personal_device', latitude: 30,
    longitude: 31, gpsAccuracyMeters: 8, installationMarker: 'installation-marker-123',
  });
  expect(form.get('faceImage')).toMatchObject({ type: 'image/jpeg', size: faceImage.size });
});
