import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { CompleteDevicePairing, DeviceAssignment, ListDevicesQuery, VerifyDevice } from '@capella/contracts';

export type PublicDevice = { id: number; assignmentType: 'employee' | 'branch'; assignmentId: number; status: 'active' | 'revoked'; browser: string; platform: string; pairedAt: Date; lastUsedAt: Date | null; revokedAt: Date | null };
type StoredCredential = { deviceId: number; credentialId: string; credentialPublicKey: string; counter: number; transports: string[] };
type PairingState = DeviceAssignment & { challenge: string | null; webauthnUserId: string | null; excludeCredentialIds: string[] };

export interface DeviceRepository {
  assignmentExists(input: DeviceAssignment): Promise<boolean>;
  createPairing(input: DeviceAssignment & { tokenHash: string }): Promise<{ id: number } | 'assignment_not_found'>;
  getPendingPairing(tokenHash: string): Promise<PairingState | null>;
  saveRegistrationChallenge(input: { tokenHash: string; challenge: string; webauthnUserId: string }): Promise<boolean>;
  activatePairing(input: DeviceAssignment & { tokenHash: string; expectedChallenge: string; credentialId: string; credentialIdHash: string; credentialPublicKey: string; counter: number; transports: string[]; credentialDeviceType: 'singleDevice' | 'multiDevice'; credentialBackedUp: boolean; installationMarkerHash: string; browser: string; platform: string }): Promise<PublicDevice | 'invalid' | 'conflict'>;
  findActiveCredential(input: DeviceAssignment & { installationMarkerHash: string }): Promise<StoredCredential | 'invalid' | 'revoked'>;
  createAuthenticationChallenge(input: { id: string; deviceId: number; challenge: string; createdAt: Date; expiresAt: Date }): Promise<boolean>;
  consumeAuthenticationChallenge(input: DeviceAssignment & { challengeId: string; credentialIdHash: string; installationMarkerHash: string; now: Date }): Promise<(StoredCredential & { challenge: string }) | 'invalid' | 'revoked'>;
  recordSuccessfulVerification(deviceId: number, expectedCounter: number, newCounter: number): Promise<PublicDevice | 'invalid' | 'revoked'>;
  cancelPairing(id: number): Promise<boolean>; revoke(id: number): Promise<boolean>;
  list(query: ListDevicesQuery): Promise<{ items: PublicDevice[]; total: number }>;
  findById(id: number): Promise<PublicDevice | null>; history(id: number): Promise<Array<{ event: 'paired' | 'verified' | 'revoked'; createdAt: Date }>>;
}

export interface WebAuthnProvider {
  registrationOptions(input: { userId: string; userName: string; excludeCredentialIds: string[] }): Promise<{ challenge: string } & object>;
  verifyRegistration(response: CompleteDevicePairing['response'], expectedChallenge: string): Promise<{ verified: false } | { verified: true; credential: { id: string; publicKey: Uint8Array; counter: number; transports?: string[] }; credentialDeviceType: 'singleDevice' | 'multiDevice'; credentialBackedUp: boolean }>;
  authenticationOptions(input: { credentialId: string; transports: string[] }): Promise<{ challenge: string } & object>;
  verifyAuthentication(response: VerifyDevice['response'], expectedChallenge: string, credential: { id: string; publicKey: Uint8Array; counter: number; transports: string[] }): Promise<{ verified: boolean; newCounter: number }>;
}

export class DeviceError extends Error {
  constructor(public readonly code: 'DEVICE_ASSIGNMENT_NOT_FOUND' | 'DEVICE_PAIRING_INVALID' | 'DEVICE_ALREADY_REGISTERED' | 'DEVICE_NOT_FOUND' | 'DEVICE_REVOKED' | 'DEVICE_PROOF_INVALID', message: string) { super(message); }
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const invalidProof = () => new DeviceError('DEVICE_PROOF_INVALID', 'تعذر التحقق من إثبات الجهاز');

export const createDeviceService = (repository: DeviceRepository, webauthn: WebAuthnProvider, options: { now?: () => Date; authenticationChallengeTtlMs?: number } = {}) => {
  const now = options.now ?? (() => new Date());
  const ttl = options.authenticationChallengeTtlMs ?? 5 * 60_000;
  return {
    async createPairing(input: DeviceAssignment) {
      if (!await repository.assignmentExists(input)) throw new DeviceError('DEVICE_ASSIGNMENT_NOT_FOUND', 'التعيين غير موجود');
      const pairingToken = randomBytes(32).toString('base64url');
      const pairing = await repository.createPairing({ ...input, tokenHash: digest(pairingToken) });
      if (pairing === 'assignment_not_found') throw new DeviceError('DEVICE_ASSIGNMENT_NOT_FOUND', 'التعيين غير موجود');
      return { id: pairing.id, pairingToken };
    },
    async beginPairing(token: string) {
      const tokenHash = digest(token); const pairing = await repository.getPendingPairing(tokenHash);
      if (!pairing) throw new DeviceError('DEVICE_PAIRING_INVALID', 'طلب ربط الجهاز غير صالح');
      const webauthnUserId = randomBytes(32).toString('base64url');
      const generated = await webauthn.registrationOptions({ userId: webauthnUserId, userName: `${pairing.assignmentType}-${pairing.assignmentId}`, excludeCredentialIds: pairing.excludeCredentialIds });
      if (!await repository.saveRegistrationChallenge({ tokenHash, challenge: generated.challenge, webauthnUserId })) throw new DeviceError('DEVICE_PAIRING_INVALID', 'طلب ربط الجهاز غير صالح');
      return generated;
    },
    async completePairing(token: string, input: CompleteDevicePairing) {
      const tokenHash = digest(token); const pairing = await repository.getPendingPairing(tokenHash);
      if (!pairing?.challenge) throw new DeviceError('DEVICE_PAIRING_INVALID', 'طلب ربط الجهاز غير صالح');
      let verification;
      try { verification = await webauthn.verifyRegistration(input.response, pairing.challenge); }
      catch { throw invalidProof(); }
      if (!verification.verified) throw invalidProof();
      if (verification.credentialDeviceType !== 'singleDevice' || verification.credentialBackedUp) throw invalidProof();
      const result = await repository.activatePairing({
        assignmentType: pairing.assignmentType, assignmentId: pairing.assignmentId, tokenHash, expectedChallenge: pairing.challenge,
        credentialId: verification.credential.id, credentialIdHash: digest(verification.credential.id),
        credentialPublicKey: Buffer.from(verification.credential.publicKey).toString('base64url'), counter: verification.credential.counter,
        transports: verification.credential.transports ?? [], credentialDeviceType: verification.credentialDeviceType,
        credentialBackedUp: verification.credentialBackedUp, installationMarkerHash: digest(input.installationMarker), browser: input.browser, platform: input.platform,
      });
      if (result === 'invalid') throw new DeviceError('DEVICE_PAIRING_INVALID', 'طلب ربط الجهاز غير صالح');
      if (result === 'conflict') throw new DeviceError('DEVICE_ALREADY_REGISTERED', 'الجهاز مسجل بالفعل');
      return result;
    },
    async beginAuthentication(assignment: DeviceAssignment, installationMarker: string) {
      const credential = await repository.findActiveCredential({ ...assignment, installationMarkerHash: digest(installationMarker) });
      if (credential === 'revoked') throw new DeviceError('DEVICE_REVOKED', 'تم إلغاء الجهاز');
      if (credential === 'invalid') throw invalidProof();
      const generated = await webauthn.authenticationOptions({ credentialId: credential.credentialId, transports: credential.transports });
      const challengeId = randomUUID(); const createdAt = now();
      if (!await repository.createAuthenticationChallenge({ id: challengeId, deviceId: credential.deviceId, challenge: generated.challenge, createdAt, expiresAt: new Date(createdAt.getTime() + ttl) })) throw invalidProof();
      return { challengeId, options: generated };
    },
    async verify(assignment: DeviceAssignment, input: VerifyDevice) {
      const credential = await repository.consumeAuthenticationChallenge({ ...assignment, challengeId: input.challengeId, credentialIdHash: digest(input.response.id), installationMarkerHash: digest(input.installationMarker), now: now() });
      if (credential === 'revoked') throw new DeviceError('DEVICE_REVOKED', 'تم إلغاء الجهاز');
      if (credential === 'invalid') throw invalidProof();
      let verification;
      try { verification = await webauthn.verifyAuthentication(input.response, credential.challenge, { id: credential.credentialId, publicKey: new Uint8Array(Buffer.from(credential.credentialPublicKey, 'base64url')), counter: credential.counter, transports: credential.transports }); }
      catch { throw invalidProof(); }
      if (!verification.verified) throw invalidProof();
      const result = await repository.recordSuccessfulVerification(credential.deviceId, credential.counter, verification.newCounter);
      if (result === 'revoked') throw new DeviceError('DEVICE_REVOKED', 'تم إلغاء الجهاز');
      if (result === 'invalid') throw invalidProof();
      return result;
    },
    async cancelPairing(id: number) { if (!await repository.cancelPairing(id)) throw new DeviceError('DEVICE_PAIRING_INVALID', 'طلب ربط الجهاز غير صالح'); },
    async revoke(id: number) { if (!await repository.revoke(id)) throw new DeviceError('DEVICE_NOT_FOUND', 'الجهاز غير موجود'); },
    list: (query: ListDevicesQuery) => repository.list(query),
    async get(id: number) { const found = await repository.findById(id); if (!found) throw new DeviceError('DEVICE_NOT_FOUND', 'الجهاز غير موجود'); return found; },
    async history(id: number) { await this.get(id); return repository.history(id); },
  };
};
export type DeviceService = ReturnType<typeof createDeviceService>;
