/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from 'vitest';
import { createDeviceService, type DeviceRepository, type WebAuthnProvider } from '../../src/modules/devices/devices-service.js';

const publicDevice = { id: 4, assignmentType: 'employee' as const, assignmentId: 8, assignmentName: 'Employee', status: 'active' as const, browser: 'Chrome', platform: 'Android', pairedAt: new Date(), lastUsedAt: null, revokedAt: null };
const repository = (): DeviceRepository => ({
  assignmentExists: vi.fn(async () => true), createPairing: vi.fn(async () => ({ id: 1 })),
  getPendingPairing: vi.fn(async () => ({ assignmentType: 'employee' as const, assignmentId: 8, challenge: null, webauthnUserId: null, excludeCredentialIds: [] })),
  saveRegistrationChallenge: vi.fn(async () => true), activatePairing: vi.fn(async () => publicDevice),
  findActiveCredential: vi.fn(async () => ({ deviceId: 4, credentialId: 'credential', credentialPublicKey: 'cHVibGlj', counter: 1, transports: ['internal'] })),
  createAuthenticationChallenge: vi.fn(async () => true), consumeAuthenticationChallenge: vi.fn(async () => ({ deviceId: 4, credentialId: 'credential', credentialPublicKey: 'cHVibGlj', counter: 1, transports: ['internal'], challenge: 'auth-challenge' })),
  recordSuccessfulVerification: vi.fn(async () => publicDevice), cancelPairing: vi.fn(), revoke: vi.fn(),
  list: vi.fn(async () => ({ items: [], total: 0 })), findById: vi.fn(), history: vi.fn(async () => []),
});
const webauthn = (): WebAuthnProvider => ({
  registrationOptions: vi.fn(async () => ({ challenge: 'register-challenge' } as never)),
  verifyRegistration: vi.fn(async () => ({ verified: true as const, credential: { id: 'credential', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] }, credentialDeviceType: 'singleDevice' as const, credentialBackedUp: false })),
  authenticationOptions: vi.fn(async () => ({ challenge: 'auth-challenge' } as never)),
  verifyAuthentication: vi.fn(async () => ({ verified: true, newCounter: 2 })),
});

describe('device service', () => {
  it('creates a server WebAuthn registration challenge for the pending pairing', async () => {
    const repo = repository(); const provider = webauthn();
    const result = await createDeviceService(repo, provider).beginPairing('pairing-token');
    expect(provider.registrationOptions).toHaveBeenCalledWith(expect.objectContaining({ userName: 'employee-8' }));
    expect(repo.saveRegistrationChallenge).toHaveBeenCalledWith(expect.objectContaining({ challenge: 'register-challenge' }));
    expect(result).toMatchObject({ challenge: 'register-challenge' });
  });

  it('activates a device only after verified registration', async () => {
    const repo = repository(); const provider = webauthn();
    vi.mocked(repo.getPendingPairing).mockResolvedValue({ assignmentType: 'employee', assignmentId: 8, challenge: 'register-challenge', webauthnUserId: 'user-id', excludeCredentialIds: [] });
    const response = { id: 'credential', rawId: 'credential', type: 'public-key' as const, response: { clientDataJSON: 'data', attestationObject: 'attestation' }, clientExtensionResults: {} };
    await createDeviceService(repo, provider).completePairing('pairing-token', { installationMarker: 'marker-marker-123', browser: 'Chrome', platform: 'Android', response });
    expect(provider.verifyRegistration).toHaveBeenCalledWith(response, 'register-challenge');
    expect(repo.activatePairing).toHaveBeenCalledWith(expect.objectContaining({ credentialId: 'credential', credentialPublicKey: 'AQID', counter: 0, expectedChallenge: 'register-challenge' }));
  });

  it('never activates a device when registration verification fails', async () => {
    const repo = repository(); const provider = webauthn();
    vi.mocked(repo.getPendingPairing).mockResolvedValue({ assignmentType: 'employee', assignmentId: 8, challenge: 'register-challenge', webauthnUserId: 'user-id', excludeCredentialIds: [] });
    vi.mocked(provider.verifyRegistration).mockResolvedValue({ verified: false });
    await expect(createDeviceService(repo, provider).completePairing('pairing-token', { installationMarker: 'marker-marker-123', browser: 'Chrome', platform: 'Android', response: { id: 'credential', rawId: 'credential', type: 'public-key', response: { clientDataJSON: 'data', attestationObject: 'attestation' }, clientExtensionResults: {} } })).rejects.toMatchObject({ code: 'DEVICE_PROOF_INVALID' });
    expect(repo.activatePairing).not.toHaveBeenCalled();
  });

  it('rejects synced or backed-up credentials that are not device-bound', async () => {
    const repo = repository(); const provider = webauthn();
    vi.mocked(repo.getPendingPairing).mockResolvedValue({ assignmentType: 'employee', assignmentId: 8, challenge: 'register-challenge', webauthnUserId: 'user-id', excludeCredentialIds: [] });
    vi.mocked(provider.verifyRegistration).mockResolvedValue({ verified: true, credential: { id: 'credential', publicKey: new Uint8Array([1]), counter: 0 }, credentialDeviceType: 'multiDevice', credentialBackedUp: true });
    await expect(createDeviceService(repo, provider).completePairing('pairing-token', { installationMarker: 'marker-marker-123', browser: 'Chrome', platform: 'Android', response: { id: 'credential', rawId: 'credential', type: 'public-key', response: { clientDataJSON: 'data', attestationObject: 'attestation' }, clientExtensionResults: {} } })).rejects.toMatchObject({ code: 'DEVICE_PROOF_INVALID' });
    expect(repo.activatePairing).not.toHaveBeenCalled();
  });

  it('consumes a one-time challenge and advances the signature counter after verification', async () => {
    const repo = repository(); const provider = webauthn();
    const options = await createDeviceService(repo, provider).beginAuthentication({ assignmentType: 'employee', assignmentId: 8 }, 'marker-marker-123');
    expect(repo.createAuthenticationChallenge).toHaveBeenCalledWith(expect.objectContaining({ challenge: 'auth-challenge' }));
    const proof = { challengeId: options.challengeId, installationMarker: 'marker-marker-123', response: { id: 'credential', rawId: 'credential', type: 'public-key' as const, response: { clientDataJSON: 'data', authenticatorData: 'auth', signature: 'signature' }, clientExtensionResults: {} } };
    await expect(createDeviceService(repo, provider).verify({ assignmentType: 'employee', assignmentId: 8 }, proof)).resolves.toMatchObject({ id: 4 });
    expect(provider.verifyAuthentication).toHaveBeenCalledWith(proof.response, 'auth-challenge', expect.objectContaining({ counter: 1 }));
    expect(repo.recordSuccessfulVerification).toHaveBeenCalledWith(4, 1, 2);
  });
});
