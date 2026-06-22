import type { AttendanceListFilterInput } from "@capella/shared";
import type { MySql2Database } from "drizzle-orm/mysql2";
import * as adminRepo from "./admin-attendance.repository";
import * as employeeRepo from "./employee-attendance.repository";

export type {
  AdminAttendanceRecord,
  AttendanceBlockedAttemptRecord,
  AttendanceSessionRecord
} from "./attendance-mappers";

type DatabaseSchema = typeof import("../../db/schema");

type CreateDrizzleAttendanceRepositoryOptions = {
  db: MySql2Database<DatabaseSchema>;
};

export function createDrizzleAttendanceRepository(
  options: CreateDrizzleAttendanceRepositoryOptions
) {
  const { db } = options;

  return {
    findEmployeeById: (employeeId: number) => employeeRepo.findEmployeeById(db, employeeId),
    findBranchById: (branchId: number) => employeeRepo.findBranchById(db, branchId),
    findActiveEmployeeDeviceFingerprint: (employeeId: number) =>
      employeeRepo.findActiveEmployeeDeviceFingerprint(db, employeeId),
    findOpenSession: (employeeId: number) => employeeRepo.findOpenSession(db, employeeId),
    listEmployeeSessions: (employeeId: number) => employeeRepo.listEmployeeSessions(db, employeeId),
    createSession: (input: Parameters<typeof employeeRepo.createSession>[1]) =>
      employeeRepo.createSession(db, input),
    completeSession: (sessionId: number, checkOutAtUtc: Date) =>
      employeeRepo.completeSession(db, sessionId, checkOutAtUtc),
    createBlockedAttempt: (input: Parameters<typeof employeeRepo.createBlockedAttempt>[1]) =>
      employeeRepo.createBlockedAttempt(db, input),
    hasWeeklyDayOff: (employeeId: number, dateKey: string) =>
      employeeRepo.hasWeeklyDayOff(db, employeeId, dateKey),
    hasPermissionAbsence: (employeeId: number, dateKey: string) =>
      employeeRepo.hasPermissionAbsence(db, employeeId, dateKey),
    isMonthLocked: (monthKey: string) => employeeRepo.isMonthLocked(db, monthKey),
    listAdminAttendance: (filters: AttendanceListFilterInput) =>
      adminRepo.listAdminAttendance(db, filters),
    findAdminAttendanceById: (sessionId: number) =>
      adminRepo.findAdminAttendanceById(db, sessionId),
    createAdminAttendance: (input: Parameters<typeof adminRepo.createAdminAttendance>[1]) =>
      adminRepo.createAdminAttendance(db, input),
    updateAdminAttendance: (sessionId: number, input: Parameters<typeof adminRepo.updateAdminAttendance>[2]) =>
      adminRepo.updateAdminAttendance(db, sessionId, input),
    deleteAdminAttendance: (sessionId: number) => adminRepo.deleteAdminAttendance(db, sessionId),
    applyPendingBranchAssignment: (employeeId: number, occurredAtUtc: Date) =>
      employeeRepo.applyPendingBranchAssignment(db, employeeId, occurredAtUtc)
  };
}
