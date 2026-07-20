import { describe, expect, it } from 'vitest';

import * as attendanceContracts from './index.js';

const contracts = attendanceContracts as typeof attendanceContracts & Record<string, unknown>;

describe('attendance contracts', () => {
  it('accepts employee code, PIN, source, GPS, and a WebAuthn device proof', () => {
    expect(contracts.employeeAttendanceEventSchema).toBeDefined();
    const schema = contracts.employeeAttendanceEventSchema as {
      safeParse(value: unknown): { success: boolean };
    };
    expect(schema.safeParse({
      employeeCode: 17,
      pin: '1234',
      source: 'personal_device',
      latitude: 30.0444,
      longitude: 31.2357,
      gpsAccuracyMeters: 8,
      deviceProof: {
        challengeId: 'b4f3550c-0230-4a73-ae58-f4086ab13206',
        installationMarker: 'installation-marker-123',
        response: {
          id: 'credential', rawId: 'credential', type: 'public-key',
          response: {
            clientDataJSON: 'client', authenticatorData: 'authenticator',
            signature: 'signature',
          },
          clientExtensionResults: {},
        },
      },
    }).success).toBe(true);
  });

  it('rejects Arabic digits, invalid PINs, and impossible coordinates', () => {
    const schema = contracts.employeeAttendanceEventSchema as {
      safeParse(value: unknown): { success: boolean };
    };
    const base = {
      employeeCode: 17,
      pin: '1234',
      source: 'branch_device',
      latitude: 30,
      longitude: 31,
      gpsAccuracyMeters: 8,
      deviceProof: {},
    };
    expect(schema.safeParse({ ...base, pin: '١٢٣٤' }).success).toBe(false);
    expect(schema.safeParse({ ...base, pin: '123' }).success).toBe(false);
    expect(schema.safeParse({ ...base, latitude: 91 }).success).toBe(false);
  });

  it('validates manual events, denied approval, timeout correction, and list filters', () => {
    expect(contracts.manualAttendanceEventSchema).toBeDefined();
    expect(contracts.attendanceDeniedAttemptParamsSchema).toBeDefined();
    expect(contracts.correctAutomaticTimeoutSchema).toBeDefined();
    expect(contracts.listAttendanceSessionsQuerySchema).toBeDefined();
    expect(contracts.listAttendanceDeniedAttemptsQuerySchema).toBeDefined();
  });

  it('requires explicit-offset ISO datetimes for manual events and timeout corrections', () => {
    const manual = contracts.manualAttendanceEventSchema;
    const correction = contracts.correctAutomaticTimeoutSchema;

    expect(manual.safeParse({ employeeId: 7, occurredAt: '2026-07-20T09:15:30+03:00' }).success).toBe(true);
    expect(correction.safeParse({ checkOutAt: '2026-07-20T06:15:30.123Z' }).success).toBe(true);
    for (const occurredAt of [null, false, '2026-07-20', '2026-07-20T09:15:30']) {
      expect(manual.safeParse({ employeeId: 7, occurredAt }).success).toBe(false);
    }
  });
});
