import { createHash, randomBytes } from 'node:crypto';
import type { CompleteDevicePairing, DeviceAssignment, ListDevicesQuery, VerifyDevice } from '@capella/contracts';
export type PublicDevice = { id: number; assignmentType: 'employee' | 'branch'; assignmentId: number; status: 'active' | 'revoked'; browser: string; platform: string; pairedAt: Date; lastUsedAt: Date | null; revokedAt: Date | null };
export interface DeviceRepository {
  assignmentExists(input: DeviceAssignment): Promise<boolean>;
  createPairing(input: DeviceAssignment & { tokenHash: string }): Promise<{ id: number }>;
  completePairing(input: CompleteDevicePairing & { tokenHash: string; credentialIdHash: string; installationMarkerHash: string }): Promise<PublicDevice | 'invalid' | 'conflict'>;
  cancelPairing(id: number): Promise<boolean>; revoke(id: number): Promise<boolean>;
  verify(input: DeviceAssignment & { credentialIdHash: string; installationMarkerHash: string }): Promise<PublicDevice | 'invalid' | 'revoked'>;
  list(query: ListDevicesQuery): Promise<{ items: PublicDevice[]; total: number }>;
  findById(id: number): Promise<PublicDevice | null>; history(id: number): Promise<Array<{ event: 'paired' | 'verified' | 'revoked'; createdAt: Date }>>;
}
export class DeviceError extends Error { constructor(public readonly code: 'DEVICE_ASSIGNMENT_NOT_FOUND' | 'DEVICE_PAIRING_INVALID' | 'DEVICE_ALREADY_REGISTERED' | 'DEVICE_NOT_FOUND' | 'DEVICE_REVOKED' | 'DEVICE_PROOF_UNSUPPORTED', message: string) { super(message); } }
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const createDeviceService = (repository: DeviceRepository) => ({
  async createPairing(input: DeviceAssignment) { if (!await repository.assignmentExists(input)) throw new DeviceError('DEVICE_ASSIGNMENT_NOT_FOUND', 'التعيين غير موجود'); const pairingToken = randomBytes(32).toString('base64url'); const pairing = await repository.createPairing({ ...input, tokenHash: digest(pairingToken) }); return { id: pairing.id, pairingToken }; },
  async completePairing(token: string, input: CompleteDevicePairing) { const result = await repository.completePairing({ ...input, tokenHash: digest(token), credentialIdHash: digest(input.credentialId), installationMarkerHash: digest(input.installationMarker) }); if (result === 'invalid') throw new DeviceError('DEVICE_PAIRING_INVALID', 'طلب ربط الجهاز غير صالح'); if (result === 'conflict') throw new DeviceError('DEVICE_ALREADY_REGISTERED', 'الجهاز مسجل بالفعل'); return result; },
  async cancelPairing(id: number) { if (!await repository.cancelPairing(id)) throw new DeviceError('DEVICE_PAIRING_INVALID', 'طلب ربط الجهاز غير صالح'); },
  async revoke(id: number) { if (!await repository.revoke(id)) throw new DeviceError('DEVICE_NOT_FOUND', 'الجهاز غير موجود'); },
  verify(assignment: DeviceAssignment, input: VerifyDevice): Promise<never> { void assignment; void input; return Promise.reject(new DeviceError('DEVICE_PROOF_UNSUPPORTED', 'إثبات الجهاز غير متاح حتى اكتمال تحقق WebAuthn')); },
  list: (query: ListDevicesQuery) => repository.list(query),
  async get(id: number) { const found = await repository.findById(id); if (!found) throw new DeviceError('DEVICE_NOT_FOUND', 'الجهاز غير موجود'); return found; },
  async history(id: number) { await this.get(id); return repository.history(id); },
});
export type DeviceService = ReturnType<typeof createDeviceService>;
