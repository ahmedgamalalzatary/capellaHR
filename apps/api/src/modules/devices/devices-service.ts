import { createHash, randomBytes } from 'node:crypto';
import type { CompleteDevicePairing, DeviceAssignment, ListDevicesQuery } from '@capella/contracts';

export type PublicDevice = { id: number; assignmentType: 'employee' | 'branch'; assignmentId: number; assignmentName: string | null; status: 'active' | 'revoked'; browser: string; platform: string; pairedAt: Date; lastUsedAt: Date | null; revokedAt: Date | null };

export interface DeviceRepository {
  assignmentExists(input: DeviceAssignment): Promise<boolean>;
  createPairing(input: DeviceAssignment & { tokenHash: string }): Promise<{ id: number } | 'assignment_not_found'>;
  activatePairing(input: { tokenHash: string; installationMarkerHash: string; browser: string; platform: string }): Promise<PublicDevice | 'invalid' | 'conflict'>;
  findActiveDevice(input: DeviceAssignment & { installationMarkerHash: string }): Promise<PublicDevice | 'invalid' | 'revoked'>;
  recordSuccessfulVerification(deviceId: number): Promise<PublicDevice | 'invalid' | 'revoked'>;
  cancelPairing(id: number): Promise<boolean>;
  revoke(id: number): Promise<boolean>;
  list(query: ListDevicesQuery): Promise<{ items: PublicDevice[]; total: number }>;
  findById(id: number): Promise<PublicDevice | null>;
  history(id: number): Promise<Array<{ event: 'paired' | 'verified' | 'revoked'; createdAt: Date }>>;
}

export class DeviceError extends Error {
  constructor(
    public readonly code: 'DEVICE_ASSIGNMENT_NOT_FOUND' | 'DEVICE_PAIRING_INVALID' | 'DEVICE_ALREADY_REGISTERED' | 'DEVICE_NOT_FOUND' | 'DEVICE_REVOKED' | 'DEVICE_INVALID',
    message: string,
    public readonly deviceId: number | null = null,
  ) { super(message); this.name = 'DeviceError'; }
}

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const invalidDevice = (deviceId: number | null = null) => new DeviceError('DEVICE_INVALID', 'تعذر التحقق من الجهاز', deviceId);

export const createDeviceService = (repository: DeviceRepository) => ({
  async createPairing(input: DeviceAssignment) {
    if (!await repository.assignmentExists(input)) throw new DeviceError('DEVICE_ASSIGNMENT_NOT_FOUND', 'التعيين غير موجود');
    const pairingToken = randomBytes(32).toString('base64url');
    const pairing = await repository.createPairing({ ...input, tokenHash: digest(pairingToken) });
    if (pairing === 'assignment_not_found') throw new DeviceError('DEVICE_ASSIGNMENT_NOT_FOUND', 'التعيين غير موجود');
    return { id: pairing.id, pairingToken };
  },
  async completePairing(token: string, input: CompleteDevicePairing) {
    const result = await repository.activatePairing({
      tokenHash: digest(token),
      installationMarkerHash: digest(input.installationMarker),
      browser: input.browser,
      platform: input.platform,
    });
    if (result === 'invalid') throw new DeviceError('DEVICE_PAIRING_INVALID', 'طلب ربط الجهاز غير صالح');
    if (result === 'conflict') throw new DeviceError('DEVICE_ALREADY_REGISTERED', 'الجهاز مسجل بالفعل');
    return result;
  },
  async verify(assignment: DeviceAssignment, installationMarker: string) {
    const candidate = await repository.findActiveDevice({
      ...assignment,
      installationMarkerHash: digest(installationMarker),
    });
    if (candidate === 'revoked') throw new DeviceError('DEVICE_REVOKED', 'تم إلغاء الجهاز');
    if (candidate === 'invalid') throw invalidDevice();
    const result = await repository.recordSuccessfulVerification(candidate.id);
    if (result === 'revoked') throw new DeviceError('DEVICE_REVOKED', 'تم إلغاء الجهاز', candidate.id);
    if (result === 'invalid') throw invalidDevice(candidate.id);
    return result;
  },
  async cancelPairing(id: number) { if (!await repository.cancelPairing(id)) throw new DeviceError('DEVICE_PAIRING_INVALID', 'طلب ربط الجهاز غير صالح'); },
  async revoke(id: number) { if (!await repository.revoke(id)) throw new DeviceError('DEVICE_NOT_FOUND', 'الجهاز غير موجود'); },
  list: (query: ListDevicesQuery) => repository.list(query),
  async get(id: number) { const found = await repository.findById(id); if (!found) throw new DeviceError('DEVICE_NOT_FOUND', 'الجهاز غير موجود'); return found; },
  async history(id: number) { await this.get(id); return repository.history(id); },
});

export type DeviceService = ReturnType<typeof createDeviceService>;
