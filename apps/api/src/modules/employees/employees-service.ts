import type { CreateEmployeeFields, ListEmployeesQuery, UpdateEmployeeFields } from '@capella/contracts';
import { hash } from 'argon2';
export type ImageKind = 'personal' | 'idFront' | 'idBack';
export type ImageMetadata = { storagePath: string; originalName: string; mimeType: string; sizeBytes: number };
export type EmployeeImages = Record<ImageKind, ImageMetadata>;
export type EmployeeRecord = Omit<CreateEmployeeFields, 'pin'> & { id: number; employeeCode: number; pinHash: string; credentialVersion: number; images: EmployeeImages; deletedAt: Date | null; createdAt: Date; updatedAt: Date };
export type PublicEmployee = Omit<EmployeeRecord, 'pinHash' | 'credentialVersion'>;
export type EmployeeTransactionContext = unknown;
type EmployeeDeleteResult = 'deleted' | 'not_found' | 'checked_in';
type EmployeeUpdateResult = { record: EmployeeRecord; replacedImages: Partial<EmployeeImages> } | 'branch_not_found' | 'checked_in';
export interface EmployeeRepository {
  create(input: Omit<CreateEmployeeFields, 'pin'> & { pinHash: string; images: EmployeeImages }): Promise<EmployeeRecord | 'branch_not_found'>;
  findActiveById(id: number): Promise<EmployeeRecord | null>;
  findIdentityByCode(code: number): Promise<{ id: number; code: number; personalPhone: string; pinHash: string; credentialVersion: number; deletedAt: Date | null } | null>;
  findPhoneOwner(phone: string, excludeId?: number): Promise<{ id: number } | null>;
  branchExists(id: number): Promise<boolean>;
  list(query: ListEmployeesQuery): Promise<{ items: EmployeeRecord[]; total: number }>;
  update(id: number, changes: Partial<Omit<EmployeeRecord, 'id' | 'employeeCode' | 'createdAt' | 'updatedAt' | 'deletedAt'>>, revokeSessions?: boolean, hasOpenSession?: (id: number, context: EmployeeTransactionContext) => Promise<boolean>): Promise<EmployeeUpdateResult | null>;
  softDeleteIfAttendanceClosed(id: number, revokeSessions: boolean, hasOpenSession: (id: number, context: EmployeeTransactionContext) => Promise<boolean>, cleanupDevices?: (id: number, context: EmployeeTransactionContext) => Promise<void>, prepareFinancials?: (id: number, deletedAt: Date, context: EmployeeTransactionContext) => Promise<void>): Promise<EmployeeDeleteResult>;
}
export class EmployeeError extends Error { constructor(public readonly code: 'EMPLOYEE_NOT_FOUND' | 'EMPLOYEE_PHONE_EXISTS' | 'EMPLOYEE_BRANCH_NOT_FOUND' | 'EMPLOYEE_CHECKED_IN' | 'EMPLOYEE_ATTENDANCE_UNAVAILABLE', message: string) { super(message); } }
const expose = ({ pinHash, credentialVersion, ...employee }: EmployeeRecord): PublicEmployee => { void pinHash; void credentialVersion; return employee; };
const isDuplicate = (error: unknown) => typeof error === 'object' && error !== null && (Reflect.get(error, 'code') === 'ER_DUP_ENTRY' || Reflect.get(Reflect.get(error, 'cause') ?? {}, 'code') === 'ER_DUP_ENTRY');
export const createEmployeeService = (repository: EmployeeRepository, attendance?: { hasOpenSession(id: number, context?: EmployeeTransactionContext): Promise<boolean>; hasAnyOpenSession(id: number, context?: EmployeeTransactionContext): Promise<boolean> }, deviceLifecycle?: { revokeEmployee(id: number, context?: EmployeeTransactionContext): Promise<void> }, financialLifecycle?: { prepareEmployeeDeletion(id: number, deletedAt: Date, context?: EmployeeTransactionContext): Promise<void> }) => ({
  async create(input: CreateEmployeeFields & { images: EmployeeImages }) {
    if (!await repository.branchExists(input.branchId)) throw new EmployeeError('EMPLOYEE_BRANCH_NOT_FOUND', 'الفرع غير موجود');
    for (const phone of new Set([input.personalPhone, input.whatsappPhone])) if (await repository.findPhoneOwner(phone)) throw new EmployeeError('EMPLOYEE_PHONE_EXISTS', 'رقم الهاتف مستخدم بالفعل');
    const { pin, images, ...fields } = input;
    try {
      const created = await repository.create({ ...fields, fullName: fields.fullName.trim(), address: fields.address.trim(), pinHash: await hash(pin), images });
      if (created === 'branch_not_found') throw new EmployeeError('EMPLOYEE_BRANCH_NOT_FOUND', 'الفرع غير موجود');
      return expose(created);
    }
    catch (error) { if (isDuplicate(error)) throw new EmployeeError('EMPLOYEE_PHONE_EXISTS', 'رقم الهاتف مستخدم بالفعل'); throw error; }
  },
  async get(id: number) { const found = await repository.findActiveById(id); if (!found) throw new EmployeeError('EMPLOYEE_NOT_FOUND', 'الموظف غير موجود'); return expose(found); },
  async list(query: ListEmployeesQuery) { const result = await repository.list(query); return { ...result, items: result.items.map(expose) }; },
  async update(id: number, input: UpdateEmployeeFields & { images?: Partial<EmployeeImages> }) {
    await this.get(id);
    for (const phone of new Set([input.personalPhone, input.whatsappPhone].filter((x): x is string => Boolean(x)))) if (await repository.findPhoneOwner(phone, id)) throw new EmployeeError('EMPLOYEE_PHONE_EXISTS', 'رقم الهاتف مستخدم بالفعل');
    const { pin, ...rawChanges } = input;
    const changes = Object.fromEntries(Object.entries(rawChanges).filter(([, value]) => value !== undefined));
    const branchSubmitted = input.branchId !== undefined;
    if (branchSubmitted && !attendance) throw new EmployeeError('EMPLOYEE_ATTENDANCE_UNAVAILABLE', 'تعذر التحقق من حالة الحضور');
    let stored: EmployeeUpdateResult | null;
    try { stored = await repository.update(
      id,
      { ...changes, ...(pin ? { pinHash: await hash(pin) } : {}) },
      Boolean(pin),
      branchSubmitted
        ? (employeeId, context) => attendance!.hasAnyOpenSession(employeeId, context)
        : undefined,
    ); }
    catch (error) { if (isDuplicate(error)) throw new EmployeeError('EMPLOYEE_PHONE_EXISTS', 'رقم الهاتف مستخدم بالفعل'); throw error; }
    if (!stored) throw new EmployeeError('EMPLOYEE_NOT_FOUND', 'الموظف غير موجود');
    if (stored === 'checked_in') throw new EmployeeError('EMPLOYEE_CHECKED_IN', 'يجب تسجيل خروج الموظف أولاً');
    if (stored === 'branch_not_found') throw new EmployeeError('EMPLOYEE_BRANCH_NOT_FOUND', 'الفرع غير موجود');
    return { employee: expose(stored.record), replacedImages: stored.replacedImages };
  },
  async remove(id: number) {
    if (!attendance) throw new EmployeeError('EMPLOYEE_ATTENDANCE_UNAVAILABLE', 'تعذر التحقق من حالة الحضور');
    const attendanceCheck = (employeeId: number, context: EmployeeTransactionContext) => attendance.hasOpenSession(employeeId, context);
    const result = deviceLifecycle || financialLifecycle
      ? await repository.softDeleteIfAttendanceClosed(
        id,
        true,
        attendanceCheck,
        deviceLifecycle ? (employeeId, context) => deviceLifecycle.revokeEmployee(employeeId, context) : undefined,
        financialLifecycle
          ? (employeeId, deletedAt, context) => financialLifecycle.prepareEmployeeDeletion(employeeId, deletedAt, context)
          : undefined,
      )
      : await repository.softDeleteIfAttendanceClosed(id, true, attendanceCheck);
    if (result === 'checked_in') throw new EmployeeError('EMPLOYEE_CHECKED_IN', 'يجب تسجيل خروج الموظف أولاً');
    if (result === 'not_found') throw new EmployeeError('EMPLOYEE_NOT_FOUND', 'الموظف غير موجود');
  },
});
export type EmployeeService = ReturnType<typeof createEmployeeService>;
