/* eslint-disable @typescript-eslint/unbound-method */
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createDeviceService, type DeviceRepository } from '../../src/modules/devices/devices-service.js';

const publicDevice = { id: 4, assignmentType: 'employee' as const, assignmentId: 8, assignmentName: 'Employee', status: 'active' as const, browser: 'Chrome', platform: 'Android', pairedAt: new Date(), lastUsedAt: null, revokedAt: null };
const repository = () => ({
  assignmentExists: vi.fn(async () => true),
  createPairing: vi.fn(async () => ({ id: 1 })),
  getPendingPairing: vi.fn(async () => null),
  activatePairing: vi.fn(async () => publicDevice),
  findActiveDevice: vi.fn(async () => publicDevice),
  recordSuccessfulVerification: vi.fn(async () => publicDevice),
  cancelPairing: vi.fn(),
  revoke: vi.fn(),
  list: vi.fn(async () => ({ items: [], total: 0 })),
  findById: vi.fn(),
  history: vi.fn(async () => []),
}) as unknown as DeviceRepository;

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

describe('device service', () => {
  it('activates a pending token directly for the exact browser marker', async () => {
    const repo = repository();

    await expect(createDeviceService(repo).completePairing('pairing-token', {
      installationMarker: 'marker-marker-123',
      browser: 'Chrome',
      platform: 'Android',
    })).resolves.toEqual(publicDevice);

    expect(repo.activatePairing).toHaveBeenCalledWith({
      tokenHash: digest('pairing-token'),
      installationMarkerHash: digest('marker-marker-123'),
      browser: 'Chrome',
      platform: 'Android',
    });
  });

  it('silently verifies the same browser marker and records its use', async () => {
    const repo = repository();
    const service = createDeviceService(repo);
    const verify = Reflect.get(service, 'verify');
    expect(verify).toBeTypeOf('function');
    if (typeof verify !== 'function') return;

    await expect(verify.call(service,
      { assignmentType: 'employee', assignmentId: 8 },
      'marker-marker-123',
    )).resolves.toEqual(publicDevice);

    expect(repo.findActiveDevice).toHaveBeenCalledWith({
      assignmentType: 'employee',
      assignmentId: 8,
      installationMarkerHash: digest('marker-marker-123'),
    });
    expect(repo.recordSuccessfulVerification).toHaveBeenCalledWith(4);
  });
});
