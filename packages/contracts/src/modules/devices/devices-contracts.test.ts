import { describe, expect, it } from 'vitest';
import { completeDevicePairingSchema, deviceAssignmentSchema, deviceIdParamsSchema, listDevicesQuerySchema, verifyDeviceSchema } from './index.js';

describe('device contracts', () => {
  it('requires an assignment type when filtering by assignment id', () => {
    expect(listDevicesQuerySchema.safeParse({ assignmentId: '12' }).success).toBe(false);
    expect(listDevicesQuerySchema.safeParse({ assignmentType: 'branch', assignmentId: '12' }).success).toBe(true);
  });

  it('requires browser WebAuthn registration output instead of trusted public-key fields', () => {
    expect(completeDevicePairingSchema.safeParse({ credentialId: 'id', publicKey: 'key', installationMarker: 'x'.repeat(16), browser: 'Chrome', platform: 'Android' }).success).toBe(false);
    expect(completeDevicePairingSchema.safeParse({
      installationMarker: 'x'.repeat(16), browser: 'Chrome', platform: 'Android',
      response: { id: 'id', rawId: 'id', type: 'public-key', response: { clientDataJSON: 'data', attestationObject: 'attestation' }, clientExtensionResults: {} },
    }).success).toBe(true);
  });

  it('requires a one-time challenge and signed WebAuthn assertion for verification', () => {
    expect(verifyDeviceSchema.safeParse({ credentialId: 'id', installationMarker: 'x'.repeat(16) }).success).toBe(false);
    expect(verifyDeviceSchema.safeParse({
      challengeId: '00000000-0000-4000-8000-000000000001', installationMarker: 'x'.repeat(16),
      response: { id: 'id', rawId: 'id', type: 'public-key', response: { clientDataJSON: 'data', authenticatorData: 'auth', signature: 'signature' }, clientExtensionResults: {} },
    }).success).toBe(true);
  });

  it('requires real JSON numbers for assignments and caps every device id at MySQL INT', () => {
    expect(deviceAssignmentSchema.safeParse({ assignmentType: 'employee', assignmentId: true }).success).toBe(false);
    expect(deviceAssignmentSchema.safeParse({ assignmentType: 'employee', assignmentId: [1] }).success).toBe(false);
    expect(deviceAssignmentSchema.safeParse({ assignmentType: 'employee', assignmentId: 2147483648 }).success).toBe(false);
    expect(deviceIdParamsSchema.safeParse({ id: '2147483648' }).success).toBe(false);
  });

  it('rejects unsafe device filters and pagination', () => {
    expect(listDevicesQuerySchema.safeParse({ assignmentType: 'branch', assignmentId: '2147483648' }).success).toBe(false);
    expect(listDevicesQuerySchema.safeParse({ page: '1e308' }).success).toBe(false);
  });

  it('trims device search and rejects blank search', () => {
    expect(listDevicesQuerySchema.parse({ search: '  Chrome  ' }).search).toBe('Chrome');
    expect(listDevicesQuerySchema.safeParse({ search: '   ' }).success).toBe(false);
  });
});
