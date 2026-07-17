/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from 'vitest';
import { createDeviceService, type DeviceRepository } from '../../src/modules/devices/devices-service.js';

const repository = (): DeviceRepository => ({
  assignmentExists: vi.fn(async () => true),
  createPairing: vi.fn(async () => ({ id: 1, token: 'pairing-token' })),
  completePairing: vi.fn(), cancelPairing: vi.fn(), revoke: vi.fn(), verify: vi.fn(),
  list: vi.fn(async () => ({ items: [], total: 0 })), findById: vi.fn(), history: vi.fn(async () => []),
});

describe('device service', () => {
  it('rejects pairing for an unknown assignment', async () => {
    const repo = repository(); vi.mocked(repo.assignmentExists).mockResolvedValue(false);
    await expect(createDeviceService(repo).createPairing({ assignmentType: 'employee', assignmentId: 8 })).rejects.toMatchObject({ code: 'DEVICE_ASSIGNMENT_NOT_FOUND' });
  });

  it('creates an opaque assignment-scoped pairing token', async () => {
    const repo = repository();
    const result = await createDeviceService(repo).createPairing({ assignmentType: 'employee', assignmentId: 8 });
    expect(repo.createPairing).toHaveBeenCalledWith(expect.objectContaining({ assignmentType: 'employee', assignmentId: 8, tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(result).toEqual(expect.objectContaining({ pairingToken: expect.any(String) }));
    expect(result).not.toHaveProperty('tokenHash');
  });

  it('stores registration material without exposing credential identifiers or markers', async () => {
    const repo = repository();
    vi.mocked(repo.completePairing).mockResolvedValue({ id: 4, assignmentType: 'employee', assignmentId: 8, status: 'active', browser: 'Chrome', platform: 'Android', pairedAt: new Date(), lastUsedAt: null, revokedAt: null });
    const result = await createDeviceService(repo).completePairing('token', { credentialId: 'credential', publicKey: 'public-key', installationMarker: 'marker', browser: 'Chrome', platform: 'Android' });
    expect(repo.completePairing).toHaveBeenCalledWith(expect.objectContaining({ tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/), credentialIdHash: expect.stringMatching(/^[a-f0-9]{64}$/), installationMarkerHash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(result).not.toHaveProperty('credentialId');
    expect(result).not.toHaveProperty('installationMarker');
  });

  it('maps a consumed pairing to a stable error', async () => {
    const repo = repository(); vi.mocked(repo.completePairing).mockResolvedValue('invalid');
    await expect(createDeviceService(repo).completePairing('used', { credentialId: 'c', publicKey: 'p', installationMarker: 'm', browser: 'b', platform: 'p' })).rejects.toMatchObject({ code: 'DEVICE_PAIRING_INVALID' });
  });

  it('does not treat stored registration identifiers as authentication proof', async () => {
    const repo = repository();
    vi.mocked(repo.verify).mockResolvedValue({ id: 4, assignmentType: 'employee', assignmentId: 8, status: 'active', browser: 'Chrome', platform: 'Android', pairedAt: new Date(), lastUsedAt: new Date(), revokedAt: null });

    await expect(createDeviceService(repo).verify(
      { assignmentType: 'employee', assignmentId: 8 },
      { credentialId: 'credential', installationMarker: 'marker' },
    )).rejects.toMatchObject({ code: 'DEVICE_PROOF_UNSUPPORTED' });

    expect(repo.verify).not.toHaveBeenCalled();
  });
});
