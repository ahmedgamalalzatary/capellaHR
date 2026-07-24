import type {
  AttendanceEventType,
  EmployeeAttendanceEvent,
  ListAttendanceDeniedAttemptsQuery,
  ListAttendanceSessionsQuery,
  ManualAttendanceEvent,
} from '@capella/contracts';

import { verifyEmployeePin } from '../auth/index.js';

type AttendanceIdentity = {
  id: number;
  employeeCode: number;
  pinHash: string;
  credentialVersion: number;
  deletedAt: Date | null;
  branchId: number;
  branchLatitude: number;
  branchLongitude: number;
  branchRadiusMeters: number;
  personalPhotoPath: string | null;
};

export type FaceComparisonResult =
  | { kind: 'match' }
  | { kind: 'mismatch' | 'face_not_found' | 'multiple_faces' | 'invalid_image' | 'failed' };

export interface AttendanceFaceGateway {
  compare(personalPhotoPath: string, liveImage: Buffer): Promise<FaceComparisonResult>;
}

export type EmployeeAttendanceSubmission = EmployeeAttendanceEvent & { faceImage: Buffer };

export type AttendanceSession = {
  id: number;
  employeeId: number;
  employeeCode: number;
  employeeName: string;
  branchId: number;
  branchName: string;
  attendanceDate: string;
  requiredMinutes: number;
  checkInAt: Date;
  checkOutAt: Date | null;
  workedMinutes: number | null;
  overtimeMinutes: number | null;
  shortageMinutes: number | null;
  automaticTimeoutAt: Date | null;
  automaticTimeoutCorrectedAt: Date | null;
  flagged: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type AttendanceDeniedAttempt = {
  id: number;
  eventType: AttendanceEventType;
  claimedEmployeeCode: number;
  employeeId: number | null;
  source: EmployeeAttendanceEvent['source'];
  deviceId: number | null;
  occurredAt: Date;
  latitude: number | null;
  longitude: number | null;
  gpsAccuracyMeters: number | null;
  distanceMeters: number | null;
  branchLatitude: number | null;
  branchLongitude: number | null;
  branchRadiusMeters: number | null;
  failureReason: string;
  suspicious: boolean;
  approvedAt: Date | null;
  approvedSessionId: number | null;
  dismissedAt: Date | null;
  createdAt: Date;
};

type AttendanceMutationFailure =
  | 'employee_not_found'
  | 'credentials_changed'
  | 'device_invalid'
  | 'out_of_range'
  | 'weekly_day_off'
  | 'session_exists'
  | 'open_session_exists'
  | 'no_open_session'
  | 'invalid_time'
  | 'not_found'
  | 'already_approved'
  | 'already_reviewed'
  | 'financially_locked'
  | 'not_automatic_timeout';

export type AttendanceMutationResult =
  | { kind: 'success'; session: AttendanceSession }
  | {
    kind: AttendanceMutationFailure;
    evaluation?: {
      distanceMeters: number;
      branchLatitude: number;
      branchLongitude: number;
      branchRadiusMeters: number;
    };
  };

export type EmployeeAttendanceMutation = {
  employeeId: number;
  expectedCredentialVersion: number;
  eventType: AttendanceEventType;
  source: EmployeeAttendanceEvent['source'];
  deviceId: number;
  occurredAt: Date;
  latitude: number;
  longitude: number;
  gpsAccuracyMeters: number;
  distanceMeters: number;
  branchLatitude: number;
  branchLongitude: number;
  branchRadiusMeters: number;
};

export type DeniedAttendanceInput = Omit<AttendanceDeniedAttempt,
  'id' | 'approvedAt' | 'approvedSessionId' | 'dismissedAt' | 'createdAt'>;

export interface AttendanceRepository {
  findIdentityByCode(code: number): Promise<AttendanceIdentity | null>;
  recordDeniedAttempt(input: DeniedAttendanceInput): Promise<AttendanceDeniedAttempt>;
  checkIn(input: EmployeeAttendanceMutation): Promise<AttendanceMutationResult>;
  checkOut(input: EmployeeAttendanceMutation): Promise<AttendanceMutationResult>;
  manualCheckIn(input: ManualAttendanceEvent): Promise<AttendanceMutationResult>;
  manualCheckOut(input: ManualAttendanceEvent): Promise<AttendanceMutationResult>;
  approveDeniedAttempt(id: number): Promise<AttendanceMutationResult>;
  dismissDeniedAttempt(id: number): Promise<
    | { kind: 'success'; attempt: AttendanceDeniedAttempt }
    | { kind: 'not_found' | 'already_reviewed' }
  >;
  correctAutomaticTimeout(id: number, checkOutAt: Date): Promise<AttendanceMutationResult>;
  getSession(id: number): Promise<AttendanceSession | null>;
  listSessions(query: ListAttendanceSessionsQuery): Promise<{ items: AttendanceSession[]; total: number }>;
  listDeniedAttempts(query: ListAttendanceDeniedAttemptsQuery): Promise<{ items: AttendanceDeniedAttempt[]; total: number }>;
  hasOpenSession(employeeId: number, context?: unknown): Promise<boolean>;
  hasAnyOpenSession(employeeId: number, context?: unknown): Promise<boolean>;
}

export interface AttendanceDeviceGateway {
  verify(
    assignment: { assignmentType: 'employee' | 'branch'; assignmentId: number },
    installationMarker: string,
  ): Promise<{ id: number; verified: boolean } | null>;
}

export class AttendanceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AttendanceError';
  }
}

const EARTH_RADIUS_METERS = 6_371_000;
const ATTENDANCE_TIMING_DUMMY_HASH = '$argon2id$v=19$m=65536,t=3,p=4$O33BRlRwoIn+0l0wzrVq7g$jTAOxanRrPw/yvMxeDaz0CHzlDf77QOU6llfV3aKaXs';
const radians = (degrees: number) => degrees * Math.PI / 180;

export const calculateDistanceMeters = (
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
) => {
  if (latitudeA === latitudeB && longitudeA === longitudeB) return 0;
  const latitudeDelta = radians(latitudeB - latitudeA);
  const longitudeDelta = radians(longitudeB - longitudeA);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB))
    * Math.sin(longitudeDelta / 2) ** 2;
  const a = Math.min(1, Math.max(0, haversine));
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const calculateAttendanceMinutes = (
  checkInAt: Date,
  checkOutAt: Date,
  requiredMinutes: number,
) => {
  const workedMinutes = Math.floor((checkOutAt.getTime() - checkInAt.getTime()) / 60_000);
  return {
    workedMinutes,
    overtimeMinutes: Math.max(0, workedMinutes - requiredMinutes),
    shortageMinutes: Math.max(0, requiredMinutes - workedMinutes),
  };
};

const failures: Record<AttendanceMutationFailure, {
  code: string;
  reason: string;
  message: string;
  suspicious: boolean;
}> = {
  employee_not_found: { code: 'ATTENDANCE_EMPLOYEE_NOT_FOUND', reason: 'EMPLOYEE_NOT_FOUND', message: 'الموظف غير موجود', suspicious: false },
  credentials_changed: { code: 'ATTENDANCE_INVALID_CREDENTIALS', reason: 'INVALID_CREDENTIALS', message: 'بيانات الموظف غير صحيحة', suspicious: true },
  device_invalid: { code: 'ATTENDANCE_DEVICE_INVALID', reason: 'DEVICE_INVALID', message: 'الجهاز غير مسجل أو ملغى', suspicious: true },
  out_of_range: { code: 'ATTENDANCE_OUT_OF_RANGE', reason: 'OUT_OF_RANGE', message: 'الموقع خارج نطاق الفرع المسموح', suspicious: true },
  weekly_day_off: { code: 'ATTENDANCE_WEEKLY_DAY_OFF', reason: 'WEEKLY_DAY_OFF', message: 'يجب إعادة يوم الراحة إلى غياب أولاً', suspicious: false },
  session_exists: { code: 'ATTENDANCE_SESSION_EXISTS', reason: 'SESSION_EXISTS', message: 'يوجد سجل حضور لهذا اليوم بالفعل', suspicious: false },
  open_session_exists: { code: 'ATTENDANCE_OPEN_SESSION_EXISTS', reason: 'OPEN_SESSION_EXISTS', message: 'يوجد تسجيل حضور مفتوح بالفعل', suspicious: false },
  no_open_session: { code: 'ATTENDANCE_NO_OPEN_SESSION', reason: 'NO_OPEN_SESSION', message: 'لا يوجد تسجيل حضور مفتوح', suspicious: false },
  invalid_time: { code: 'ATTENDANCE_INVALID_TIME', reason: 'INVALID_TIME', message: 'وقت الحضور غير صالح', suspicious: false },
  not_found: { code: 'ATTENDANCE_NOT_FOUND', reason: 'NOT_FOUND', message: 'سجل الحضور غير موجود', suspicious: false },
  already_approved: { code: 'ATTENDANCE_DENIED_ALREADY_APPROVED', reason: 'ALREADY_APPROVED', message: 'تمت الموافقة على المحاولة من قبل', suspicious: false },
  already_reviewed: { code: 'ATTENDANCE_DENIED_ALREADY_REVIEWED', reason: 'ALREADY_REVIEWED', message: 'تمت مراجعة المحاولة من قبل', suspicious: false },
  financially_locked: { code: 'ATTENDANCE_FINANCIALLY_LOCKED', reason: 'FINANCIALLY_LOCKED', message: 'تم اعتماد الفترة ماليًا ولا يمكن تعديلها', suspicious: false },
  not_automatic_timeout: { code: 'ATTENDANCE_AUTOMATIC_TIMEOUT_ONLY', reason: 'NOT_AUTOMATIC_TIMEOUT', message: 'يمكن تصحيح الخروج التلقائي فقط', suspicious: false },
};

const mutationValue = (result: AttendanceMutationResult) => {
  if (result.kind === 'success') return result.session;
  const failure = failures[result.kind];
  throw new AttendanceError(failure.code, failure.message);
};

export const createAttendanceService = (
  repository: AttendanceRepository,
  devices: AttendanceDeviceGateway,
  faces: AttendanceFaceGateway,
  options: {
    now?: () => Date;
    verifyPin?: (pinHash: string, pin: string) => Promise<boolean>;
  } = {},
) => {
  const now = options.now ?? (() => new Date());
  const verifyPin = options.verifyPin ?? verifyEmployeePin;

  const employeeEvent = async (
    eventType: AttendanceEventType,
    input: EmployeeAttendanceSubmission,
  ) => {
    const occurredAt = now();
    const identity = await repository.findIdentityByCode(input.employeeCode);
    const distanceMeters = identity
      ? calculateDistanceMeters(
        input.latitude,
        input.longitude,
        identity.branchLatitude,
        identity.branchLongitude,
      )
      : null;
    let deviceId: number | null = null;

    const deniedBase = (
      failureReason: string,
      suspicious: boolean,
      evaluation?: {
        distanceMeters: number;
        branchLatitude: number;
        branchLongitude: number;
        branchRadiusMeters: number;
      },
    ): DeniedAttendanceInput => ({
      eventType,
      claimedEmployeeCode: input.employeeCode,
      employeeId: identity?.id ?? null,
      source: input.source,
      deviceId,
      occurredAt,
      latitude: input.latitude,
      longitude: input.longitude,
      gpsAccuracyMeters: input.gpsAccuracyMeters,
      distanceMeters: evaluation?.distanceMeters ?? distanceMeters,
      branchLatitude: evaluation?.branchLatitude ?? identity?.branchLatitude ?? null,
      branchLongitude: evaluation?.branchLongitude ?? identity?.branchLongitude ?? null,
      branchRadiusMeters: evaluation?.branchRadiusMeters ?? identity?.branchRadiusMeters ?? null,
      failureReason,
      suspicious,
    });
    const deny = async (failure: { code: string; reason: string; message: string; suspicious: boolean }) => {
      await repository.recordDeniedAttempt(deniedBase(failure.reason, failure.suspicious));
      throw new AttendanceError(failure.code, failure.message);
    };

    const pinValid = await verifyPin(identity?.pinHash ?? ATTENDANCE_TIMING_DUMMY_HASH, input.pin);
    if (!identity || identity.deletedAt || !pinValid) {
      return deny(failures.credentials_changed);
    }
    const assignment = input.source === 'personal_device'
      ? { assignmentType: 'employee' as const, assignmentId: identity.id }
      : { assignmentType: 'branch' as const, assignmentId: identity.branchId };
    const verifiedDevice = await devices.verify(assignment, input.installationMarker);
    deviceId = verifiedDevice?.id ?? null;
    if (!verifiedDevice?.verified) {
      return deny(failures.device_invalid);
    }
    if (distanceMeters === null || !Number.isFinite(distanceMeters) || distanceMeters > identity.branchRadiusMeters) {
      return deny({
        code: 'ATTENDANCE_OUT_OF_RANGE',
        reason: 'OUT_OF_RANGE',
        message: 'الموقع خارج نطاق الفرع المسموح',
        suspicious: true,
      });
    }

    if (!identity.personalPhotoPath) {
      return deny({
        code: 'ATTENDANCE_FACE_COMPARISON_FAILED', reason: 'FACE_COMPARISON_FAILED',
        message: 'لا توجد صورة شخصية صالحة للموظف', suspicious: false,
      });
    }
    const faceResult = await faces.compare(identity.personalPhotoPath, input.faceImage);
    if (faceResult.kind !== 'match') {
      const faceFailures = {
        mismatch: { code: 'ATTENDANCE_FACE_MISMATCH', reason: 'FACE_MISMATCH', message: 'الصورة لا تطابق صورة الموظف', suspicious: true },
        face_not_found: { code: 'ATTENDANCE_FACE_NOT_FOUND', reason: 'FACE_NOT_FOUND', message: 'لم يتم العثور على وجه واضح في الصورة', suspicious: false },
        multiple_faces: { code: 'ATTENDANCE_MULTIPLE_FACES', reason: 'MULTIPLE_FACES', message: 'يجب أن يظهر وجه واحد فقط في الصورة', suspicious: true },
        invalid_image: { code: 'ATTENDANCE_FACE_IMAGE_INVALID', reason: 'FACE_IMAGE_INVALID', message: 'صورة الكاميرا غير صالحة', suspicious: false },
        failed: { code: 'ATTENDANCE_FACE_COMPARISON_FAILED', reason: 'FACE_COMPARISON_FAILED', message: 'تعذر التحقق من الصورة الآن', suspicious: false },
      } as const;
      return deny(faceFailures[faceResult.kind]);
    }
    const mutation: EmployeeAttendanceMutation = {
      employeeId: identity.id,
      expectedCredentialVersion: identity.credentialVersion,
      eventType,
      source: input.source,
      deviceId: verifiedDevice.id,
      occurredAt,
      latitude: input.latitude,
      longitude: input.longitude,
      gpsAccuracyMeters: input.gpsAccuracyMeters,
      distanceMeters,
      branchLatitude: identity.branchLatitude,
      branchLongitude: identity.branchLongitude,
      branchRadiusMeters: identity.branchRadiusMeters,
    };
    const result = eventType === 'check_in'
      ? await repository.checkIn(mutation)
      : await repository.checkOut(mutation);
    if (result.kind === 'success') return result.session;
    const failure = failures[result.kind];
    await repository.recordDeniedAttempt(deniedBase(
      failure.reason,
      failure.suspicious,
      result.evaluation,
    ));
    throw new AttendanceError(failure.code, failure.message);
  };

  const ensureNotFuture = (occurredAt: Date) => {
    if (occurredAt.getTime() > now().getTime()) {
      throw new AttendanceError('ATTENDANCE_FUTURE_EVENT', 'لا يمكن تسجيل حدث حضور في المستقبل');
    }
  };

  return {
    checkIn: (input: EmployeeAttendanceSubmission) => employeeEvent('check_in', input),
    checkOut: (input: EmployeeAttendanceSubmission) => employeeEvent('check_out', input),
    async manualCheckIn(input: ManualAttendanceEvent) {
      ensureNotFuture(input.occurredAt);
      return mutationValue(await repository.manualCheckIn(input));
    },
    async manualCheckOut(input: ManualAttendanceEvent) {
      ensureNotFuture(input.occurredAt);
      return mutationValue(await repository.manualCheckOut(input));
    },
    async approveDeniedAttempt(id: number) {
      return mutationValue(await repository.approveDeniedAttempt(id));
    },
    async dismissDeniedAttempt(id: number) {
      const result = await repository.dismissDeniedAttempt(id);
      if (result.kind === 'success') return result.attempt;
      if (result.kind === 'not_found') throw new AttendanceError(
        'ATTENDANCE_NOT_FOUND',
        'محاولة الحضور غير موجودة',
      );
      throw new AttendanceError(
        'ATTENDANCE_DENIED_ALREADY_REVIEWED',
        'تمت مراجعة المحاولة من قبل',
      );
    },
    async correctAutomaticTimeout(id: number, input: { checkOutAt: Date }) {
      ensureNotFuture(input.checkOutAt);
      return mutationValue(await repository.correctAutomaticTimeout(id, input.checkOutAt));
    },
    async getSession(id: number) {
      const found = await repository.getSession(id);
      if (!found) throw new AttendanceError('ATTENDANCE_NOT_FOUND', 'سجل الحضور غير موجود');
      return found;
    },
    listSessions: (query: ListAttendanceSessionsQuery) => repository.listSessions(query),
    listDeniedAttempts: (query: ListAttendanceDeniedAttemptsQuery) => repository.listDeniedAttempts(query),
    hasOpenSession: (employeeId: number, context?: unknown) => repository.hasOpenSession(employeeId, context),
    hasAnyOpenSession: (employeeId: number, context?: unknown) => repository.hasAnyOpenSession(employeeId, context),
  };
};

export type AttendanceService = ReturnType<typeof createAttendanceService>;
