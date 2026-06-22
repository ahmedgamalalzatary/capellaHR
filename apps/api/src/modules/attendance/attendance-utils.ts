import type {
  AdminAttendanceRecord,
  AttendanceBlockedAttemptRecord,
  AttendanceSessionRecord
} from "./repository";
import type { AttendanceListFilterInput } from "@capella/shared";

export type EmployeeAttendanceRecord = {
  id: number;
  fullName: string;
  branchId: number | null;
  softDeletedAt: Date | null;
};

export type BranchPolicyRecord = {
  id: number;
  setupStatus: "setup_pending" | "completed";
  gpsLatitude: string;
  gpsLongitude: string;
  gpsRadiusMeters: number;
  allowedIpCidr: string;
  registeredDeviceToken: string | null;
};

export type AttendanceState = {
  employeeId: number;
  currentAction: "check_in" | "check_out";
  openSession: AttendanceSessionRecord | null;
  todaySessions: AttendanceSessionRecord[];
};

export type AttendanceBlockedResult = AttendanceState & {
  blockedAttempt: AttendanceBlockedAttemptRecord;
};

export type AttendanceRepository = {
  findEmployeeById(employeeId: number): Promise<EmployeeAttendanceRecord | null>;
  findBranchById(branchId: number): Promise<BranchPolicyRecord | null>;
  findActiveEmployeeDeviceFingerprint(employeeId: number): Promise<string | null>;
  findOpenSession(employeeId: number): Promise<AttendanceSessionRecord | null>;
  listEmployeeSessions(employeeId: number): Promise<AttendanceSessionRecord[]>;
  createSession(input: {
    employeeId: number;
    branchId: number;
    checkInAtUtc: Date;
    checkInLatitude: number;
    checkInLongitude: number;
    checkInIpAddress: string;
    deviceId: string;
    branchPolicySnapshot: Record<string, unknown>;
  }): Promise<AttendanceSessionRecord>;
  completeSession(sessionId: number, checkOutAtUtc: Date): Promise<AttendanceSessionRecord | null>;
  createBlockedAttempt(input: {
    employeeId: number;
    branchId: number | null;
    attemptedAction: "check_in" | "check_out";
    failureReasons: string[];
    latitude: number;
    longitude: number;
    ipAddress: string;
    deviceId: string;
    branchPolicySnapshot: Record<string, unknown>;
    occurredAtUtc: Date;
  }): Promise<AttendanceBlockedAttemptRecord>;
  hasWeeklyDayOff(employeeId: number, dateKey: string): Promise<boolean>;
  hasPermissionAbsence(employeeId: number, dateKey: string): Promise<boolean>;
  isMonthLocked(monthKey: string): Promise<boolean>;
  listAdminAttendance(filters: AttendanceListFilterInput): Promise<AdminAttendanceRecord[]>;
  findAdminAttendanceById(sessionId: number): Promise<AdminAttendanceRecord | null>;
  createAdminAttendance(input: {
    employeeId: number;
    branchId: number;
    checkInAtUtc: Date;
    checkOutAtUtc: Date | null;
    reason: string;
    adminId: number;
  }): Promise<AdminAttendanceRecord>;
  updateAdminAttendance(sessionId: number, input: {
    branchId: number;
    checkInAtUtc: Date;
    checkOutAtUtc: Date | null;
    reason: string;
    adminId: number;
  }): Promise<AdminAttendanceRecord | null>;
  deleteAdminAttendance(sessionId: number): Promise<boolean>;
  applyPendingBranchAssignment(employeeId: number, occurredAtUtc: Date): Promise<boolean>;
};

export function buildAttendanceState(
  employeeId: number,
  sessions: AttendanceSessionRecord[],
  openSession: AttendanceSessionRecord | null,
  now: Date
): AttendanceState {
  const todayKey = getCairoDateKey(now);

  return {
    employeeId,
    currentAction: openSession ? "check_out" : "check_in",
    openSession,
    todaySessions: sessions.filter((session) => getCairoDateKey(session.checkInAtUtc) === todayKey)
  };
}

export function createBranchPolicySnapshot(branch: BranchPolicyRecord): Record<string, unknown> {
  return {
    branchId: branch.id,
    gpsLatitude: branch.gpsLatitude,
    gpsLongitude: branch.gpsLongitude,
    gpsRadiusMeters: branch.gpsRadiusMeters,
    allowedIpCidr: branch.allowedIpCidr,
    registeredDeviceToken: branch.registeredDeviceToken
  };
}

export function getCairoDateKey(value: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(value);
}

export function isAllowedDevice(
  deviceId: string,
  activeDeviceFingerprint: string | null,
  branchDeviceToken: string | null
) {
  return deviceId === activeDeviceFingerprint || deviceId === branchDeviceToken;
}

export function isWithinRadiusMeters(
  latitude: number,
  longitude: number,
  targetLatitude: number,
  targetLongitude: number,
  radiusMeters: number
) {
  const toRadians = (degrees: number) => degrees * (Math.PI / 180);
  const earthRadiusMeters = 6371000;
  const latitudeDelta = toRadians(targetLatitude - latitude);
  const longitudeDelta = toRadians(targetLongitude - longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(latitude))
    * Math.cos(toRadians(targetLatitude))
    * Math.sin(longitudeDelta / 2) ** 2;
  const distance = 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return distance <= radiusMeters;
}

export function isIpInCidr(ipAddress: string, allowedIpCidr: string) {
  const normalizedIp = normalizeIpv4(ipAddress);

  if (!normalizedIp) {
    return false;
  }

  const [range, prefixText] = allowedIpCidr.split("/");
  const normalizedRange = normalizeIpv4(range ?? "");

  if (!normalizedRange) {
    return false;
  }

  const prefix = Number(prefixText ?? "32");

  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }

  const ipBits = ipv4ToInt(normalizedIp);
  const rangeBits = ipv4ToInt(normalizedRange);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;

  return (ipBits & mask) === (rangeBits & mask);
}

function normalizeIpv4(value: string) {
  const normalized = value.replace("::ffff:", "").trim();
  const octets = normalized.split(".");

  if (octets.length !== 4) {
    return null;
  }

  const parsedOctets = octets.map((octet) => Number(octet));

  if (parsedOctets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }

  return parsedOctets.join(".");
}

function ipv4ToInt(value: string) {
  return value
    .split(".")
    .map((octet) => Number(octet))
    .reduce((result, octet) => ((result << 8) | octet) >>> 0, 0);
}
