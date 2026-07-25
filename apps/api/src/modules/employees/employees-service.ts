import type { CreateEmployeeFields, EmployeeDeactivationInput, ListEmployeesQuery, UpdateEmployeeFields } from '@capella/contracts';
import { hash } from 'argon2';
export type ImageKind = 'personal' | 'idFront' | 'idBack';
export type ImageMetadata = { storagePath: string; originalName: string; mimeType: string; sizeBytes: number };
export type EmployeeImages = Record<ImageKind, ImageMetadata>;
export type EmployeeRecord = Omit<CreateEmployeeFields, 'pin'> & { id: number; employeeCode: number; pinHash: string; credentialVersion: number; employmentStatus: 'active' | 'inactive'; images: EmployeeImages; deletedAt: Date | null; createdAt: Date; updatedAt: Date };
export type PublicEmployee = Omit<EmployeeRecord, 'pinHash' | 'credentialVersion'>;
export type EmployeeTransactionContext = unknown;
type EmployeeDeleteResult = 'deleted' | 'not_found' | 'checked_in';
type EmployeeUpdateResult = { record: EmployeeRecord; replacedImages: Partial<EmployeeImages> } | 'branch_not_found' | 'checked_in';
export type EmployeeDeactivationPreview = { unpaidInstallmentCount: number; unpaidAdvanceAmount: string; currentNetSalary: string; projectedNetSalary: string; amountOwed: string; canZeroSalary: boolean };
/**
 * The admin's decisions, plus the figures they were shown. `expected` is absent when a deferred
 * deactivation is replayed at check-out: the closing shift is allowed to have moved the amounts,
 * which is precisely what the admin was warned about, so re-checking them would only fail.
 */
export type EmployeeDeactivationDecisions = {
  advanceDecision: EmployeeDeactivationInput['advanceDecision'];
  negativeBalanceDecision?: EmployeeDeactivationInput['negativeBalanceDecision'];
  expected?: {
    unpaidInstallmentCount: number;
    unpaidAdvanceAmount: string;
    projectedNetSalary: string;
    amountOwed: string;
  };
};
export const toDeactivationDecisions = (input: EmployeeDeactivationInput): EmployeeDeactivationDecisions => ({
  advanceDecision: input.advanceDecision,
  ...(input.negativeBalanceDecision === undefined ? {} : { negativeBalanceDecision: input.negativeBalanceDecision }),
  expected: {
    unpaidInstallmentCount: input.expectedUnpaidInstallmentCount,
    unpaidAdvanceAmount: input.expectedUnpaidAdvanceAmount,
    projectedNetSalary: input.expectedProjectedNetSalary,
    amountOwed: input.expectedAmountOwed,
  },
});
export type EmployeeFinancialLifecycle = {
  prepareEmployeeDeletion(id: number, deletedAt: Date, context?: EmployeeTransactionContext): Promise<void>;
  previewEmployeeDeactivation?(id: number): Promise<EmployeeDeactivationPreview>;
  prepareEmployeeDeactivation?(id: number, at: Date, decisions: EmployeeDeactivationDecisions, context: EmployeeTransactionContext): Promise<void>;
};
export interface EmployeeRepository {
  create(input: Omit<CreateEmployeeFields, 'pin'> & { pinHash: string; images: EmployeeImages }): Promise<EmployeeRecord | 'branch_not_found'>;
  findActiveById(id: number): Promise<EmployeeRecord | null>;
  findIdentityByCode(code: number): Promise<{ id: number; code: number; personalPhone: string; pinHash: string; credentialVersion: number; employmentStatus: 'active' | 'inactive'; deletedAt: Date | null } | null>;
  findPhoneOwner(phone: string, excludeId?: number): Promise<{ id: number } | null>;
  branchExists(id: number): Promise<boolean>;
  list(query: ListEmployeesQuery): Promise<{ items: EmployeeRecord[]; total: number }>;
  update(id: number, changes: Partial<Omit<EmployeeRecord, 'id' | 'employeeCode' | 'createdAt' | 'updatedAt' | 'deletedAt'>>, revokeSessions?: boolean, hasOpenSession?: (id: number, context: EmployeeTransactionContext) => Promise<boolean>): Promise<EmployeeUpdateResult | null>;
  softDeleteIfAttendanceClosed(id: number, revokeSessions: boolean, hasOpenSession: (id: number, context: EmployeeTransactionContext) => Promise<boolean>, cleanupDevices?: (id: number, context: EmployeeTransactionContext) => Promise<void>, prepareFinancials?: (id: number, deletedAt: Date, context: EmployeeTransactionContext) => Promise<void>): Promise<EmployeeDeleteResult>;
  previewDeactivation(id: number): Promise<{ kind: 'success' } | { kind: 'not_found' } | { kind: 'already_inactive' }>;
  deactivate(id: number, decisions: EmployeeDeactivationDecisions, prepareFinancials?: (id: number, at: Date, decisions: EmployeeDeactivationDecisions, context: EmployeeTransactionContext) => Promise<void>, hasOpenSession?: (id: number, context: EmployeeTransactionContext) => Promise<boolean>): Promise<{ kind: 'success' | 'pending'; record: EmployeeRecord } | { kind: 'not_found' } | { kind: 'already_inactive' }>;
  /** Runs the deactivation a checked-in employee deferred, once their session closes. */
  applyPendingDeactivation(id: number, at: Date, context: EmployeeTransactionContext, prepareFinancials?: (id: number, at: Date, decisions: EmployeeDeactivationDecisions, context: EmployeeTransactionContext) => Promise<void>): Promise<boolean>;
  activate(id: number): Promise<{ kind: 'success'; record: EmployeeRecord } | { kind: 'not_found' } | { kind: 'already_active' }>;
}
export class EmployeeError extends Error { constructor(public readonly code: 'EMPLOYEE_NOT_FOUND' | 'EMPLOYEE_PHONE_EXISTS' | 'EMPLOYEE_BRANCH_NOT_FOUND' | 'EMPLOYEE_CHECKED_IN' | 'EMPLOYEE_ATTENDANCE_UNAVAILABLE' | 'EMPLOYEE_FINANCIALS_UNAVAILABLE' | 'EMPLOYEE_ALREADY_ACTIVE' | 'EMPLOYEE_ALREADY_INACTIVE' | 'EMPLOYEE_DEACTIVATION_PREVIEW_CHANGED' | 'EMPLOYEE_PAYROLL_FINALIZED' | 'EMPLOYEE_PAYROLL_BLOCKED' | 'EMPLOYEE_NEGATIVE_BALANCE_DECISION_REQUIRED' | 'EMPLOYEE_ZERO_SALARY_NOT_ALLOWED', message: string) { super(message); } }
const expose = ({ pinHash, credentialVersion, ...employee }: EmployeeRecord): PublicEmployee => { void pinHash; void credentialVersion; return employee; };
const isDuplicate = (error: unknown) => typeof error === 'object' && error !== null && (Reflect.get(error, 'code') === 'ER_DUP_ENTRY' || Reflect.get(Reflect.get(error, 'cause') ?? {}, 'code') === 'ER_DUP_ENTRY');
export const createEmployeeService = (repository: EmployeeRepository, attendance?: { hasOpenSession(id: number, context?: EmployeeTransactionContext): Promise<boolean>; hasAnyOpenSession(id: number, context?: EmployeeTransactionContext): Promise<boolean> }, deviceLifecycle?: { revokeEmployee(id: number, context?: EmployeeTransactionContext): Promise<void> }, financialLifecycle?: EmployeeFinancialLifecycle) => ({
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
  async previewDeactivation(id: number) {
    // Without attendance there is no way to know whether the deactivation would be deferred, and
    // reporting `hasOpenSession: false` would silently promise it takes effect immediately.
    if (!attendance) throw new EmployeeError('EMPLOYEE_ATTENDANCE_UNAVAILABLE', 'تعذر التحقق من حالة الحضور');
    const result = await repository.previewDeactivation(id);
    if (result.kind === 'not_found') throw new EmployeeError('EMPLOYEE_NOT_FOUND', 'الموظف غير موجود');
    if (result.kind === 'already_inactive') throw new EmployeeError('EMPLOYEE_ALREADY_INACTIVE', 'الموظف غير نشط بالفعل');
    // Only the financial lifecycle can reach payroll and advances, so without it there is no
    // honest preview to give: fail loudly instead of reporting zeroed amounts.
    if (!financialLifecycle?.previewEmployeeDeactivation) {
      throw new EmployeeError('EMPLOYEE_FINANCIALS_UNAVAILABLE', 'تعذر حساب الأثر المالي للتعطيل');
    }
    const preview = await financialLifecycle.previewEmployeeDeactivation(id);
    // Surfaced so the admin is warned up front that the deactivation will wait for check-out.
    return { ...preview, hasOpenSession: await attendance.hasOpenSession(id) };
  },
  async deactivate(id: number, input: EmployeeDeactivationInput) {
    // Fail closed like `remove`: without attendance a checked-in employee would be deactivated
    // mid-shift instead of being deferred to check-out.
    if (!attendance) throw new EmployeeError('EMPLOYEE_ATTENDANCE_UNAVAILABLE', 'تعذر التحقق من حالة الحضور');
    const prepareFinancials = financialLifecycle?.prepareEmployeeDeactivation
      ? (employeeId: number, at: Date, decisions: EmployeeDeactivationDecisions, context: EmployeeTransactionContext) => financialLifecycle.prepareEmployeeDeactivation!(employeeId, at, decisions, context)
      : undefined;
    // A checked-in employee keeps working: the repository stores the decisions and the
    // deactivation is replayed when the session closes.
    const openSessionCheck = (employeeId: number, context: EmployeeTransactionContext) => (
      attendance.hasOpenSession(employeeId, context)
    );
    const result = await repository.deactivate(id, toDeactivationDecisions(input), prepareFinancials, openSessionCheck);
    if (result.kind === 'not_found') throw new EmployeeError('EMPLOYEE_NOT_FOUND', 'الموظف غير موجود');
    if (result.kind === 'already_inactive') throw new EmployeeError('EMPLOYEE_ALREADY_INACTIVE', 'الموظف غير نشط بالفعل');
    return { employee: expose(result.record), pendingUntilCheckOut: result.kind === 'pending' };
  },
  applyPendingDeactivation(id: number, at: Date, context: EmployeeTransactionContext) {
    const prepareFinancials = financialLifecycle?.prepareEmployeeDeactivation
      ? (employeeId: number, instant: Date, decisions: EmployeeDeactivationDecisions, transaction: EmployeeTransactionContext) => financialLifecycle.prepareEmployeeDeactivation!(employeeId, instant, decisions, transaction)
      : undefined;
    return repository.applyPendingDeactivation(id, at, context, prepareFinancials);
  },
  async activate(id: number) {
    const result = await repository.activate(id);
    if (result.kind === 'not_found') throw new EmployeeError('EMPLOYEE_NOT_FOUND', 'الموظف غير موجود');
    if (result.kind === 'already_active') throw new EmployeeError('EMPLOYEE_ALREADY_ACTIVE', 'الموظف نشط بالفعل');
    return expose(result.record);
  },
});
export type EmployeeService = ReturnType<typeof createEmployeeService>;
