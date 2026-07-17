import { describe, expect, it } from 'vitest';
import { createWebAuthnProvider } from '../../src/modules/devices/webauthn-provider.js';

const provider = createWebAuthnProvider({ rpName: 'Capella HR', rpId: 'localhost', origin: 'http://localhost:3000' });

describe('WebAuthn provider', () => {
  it('generates platform-bound registration and authentication challenges', async () => {
    const registration = await provider.registrationOptions({ userId: Buffer.alloc(32, 1).toString('base64url'), userName: 'employee-1', excludeCredentialIds: [] });
    expect(registration).toMatchObject({ rp: { id: 'localhost', name: 'Capella HR' }, challenge: expect.any(String), authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' } });
    const authentication = await provider.authenticationOptions({ credentialId: 'credential', transports: ['internal'] });
    expect(authentication).toMatchObject({ rpId: 'localhost', challenge: expect.any(String), userVerification: 'required', allowCredentials: [{ id: 'credential' }] });
  });

  it('cryptographically rejects malformed registration and authentication responses', async () => {
    await expect(provider.verifyRegistration({ id: 'credential', rawId: 'credential', type: 'public-key', response: { clientDataJSON: 'invalid', attestationObject: 'invalid' }, clientExtensionResults: {} }, 'challenge')).rejects.toBeInstanceOf(Error);
    await expect(provider.verifyAuthentication({ id: 'credential', rawId: 'credential', type: 'public-key', response: { clientDataJSON: 'invalid', authenticatorData: 'invalid', signature: 'invalid' }, clientExtensionResults: {} }, 'challenge', { id: 'credential', publicKey: new Uint8Array([1]), counter: 0, transports: ['internal'] })).rejects.toBeInstanceOf(Error);
  });
});
