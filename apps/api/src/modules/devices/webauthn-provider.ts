import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { WebAuthnProvider } from './devices-service.js';

export const createWebAuthnProvider = (config: { rpName: string; rpId: string; origin: string }): WebAuthnProvider => ({
  registrationOptions(input) {
    return generateRegistrationOptions({
      rpName: config.rpName, rpID: config.rpId,
      userID: new Uint8Array(Buffer.from(input.userId, 'base64url')), userName: input.userName,
      attestationType: 'none', supportedAlgorithmIDs: [-7, -257],
      excludeCredentials: input.excludeCredentialIds.map((id) => ({ id })),
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
    });
  },
  async verifyRegistration(response, expectedChallenge) {
    const result = await verifyRegistrationResponse({ response: response as RegistrationResponseJSON, expectedChallenge, expectedOrigin: config.origin, expectedRPID: config.rpId, requireUserVerification: true });
    if (!result.verified || !result.registrationInfo) return { verified: false };
    return { verified: true, credential: { ...result.registrationInfo.credential, transports: (result.registrationInfo.credential.transports as string[] | undefined) ?? [] }, credentialDeviceType: result.registrationInfo.credentialDeviceType, credentialBackedUp: result.registrationInfo.credentialBackedUp };
  },
  authenticationOptions(input) {
    return generateAuthenticationOptions({ rpID: config.rpId, allowCredentials: [{ id: input.credentialId, transports: input.transports as AuthenticatorTransportFuture[] }], userVerification: 'required' });
  },
  async verifyAuthentication(response, expectedChallenge, credential) {
    const result = await verifyAuthenticationResponse({
      response: response as AuthenticationResponseJSON, expectedChallenge, expectedOrigin: config.origin, expectedRPID: config.rpId,
      credential: { id: credential.id, publicKey: Uint8Array.from(credential.publicKey), counter: credential.counter, transports: credential.transports as AuthenticatorTransportFuture[] },
      requireUserVerification: true,
    });
    return { verified: result.verified, newCounter: result.authenticationInfo.newCounter };
  },
});
