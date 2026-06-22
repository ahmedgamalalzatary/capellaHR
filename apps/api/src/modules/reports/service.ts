import type { MonthlyAttendanceSummaryFilterInput } from "@capella/shared";

export type MonthlyAttendanceSummaryRow = {
  employeeId: number;
  employeeName: string;
  branchId: number | null;
  branchName: string | null;
  month: string;
  attendanceDays: number;
  weeklyDaysOff: number;
  absenceWithPermission: number;
  absenceWithoutPermission: number;
};

type EmployeeSummaryBase = {
  id: number;
  fullName: string;
  branchId: number | null;
  branchName: string | null;
};

type AttendanceDateRecord = {
  date: string;
  branchId: number | null;
  branchName: string | null;
};

type BranchAssignmentRecord = {
  branchId: number;
  branchName: string;
  effectiveFrom: string;
  effectiveTo: null | string;
};

export type ReportsRepository = {
  listEmployees(filters: {
    employeeId?: number;
  }): Promise<EmployeeSummaryBase[]>;
  listCompletedAttendanceDates(employeeId: number, month: string): Promise<AttendanceDateRecord[]>;
  listWeeklyDayOffDates(employeeId: number, month: string): Promise<string[]>;
  listPermissionAbsenceDates(employeeId: number, month: string): Promise<string[]>;
  listBranchAssignments(employeeId: number, month: string): Promise<BranchAssignmentRecord[]>;
};

type CreateReportsServiceOptions = {
  repository: ReportsRepository;
};

type SummaryBucket = {
  employeeId: number;
  employeeName: string;
  branchId: number | null;
  branchName: string | null;
  month: string;
  attendanceDates: Set<string>;
  weeklyDayOffDates: Set<string>;
  permissionDates: Set<string>;
  absenceWithoutPermission: number;
};

export function createReportsService(options: CreateReportsServiceOptions) {
  return {
    async getMonthlyAttendanceSummary(filters: MonthlyAttendanceSummaryFilterInput) {
      const employees = await options.repository.listEmployees({
        employeeId: filters.employeeId
      });

      const summaryBuckets = await Promise.all(
        employees.map(async (employee) => {
          const [attendanceDates, weeklyDayOffDates, permissionAbsenceDates, branchAssignments] = await Promise.all([
            options.repository.listCompletedAttendanceDates(employee.id, filters.month),
            options.repository.listWeeklyDayOffDates(employee.id, filters.month),
            options.repository.listPermissionAbsenceDates(employee.id, filters.month),
            options.repository.listBranchAssignments(employee.id, filters.month)
          ]);

          return buildEmployeeSummaryBuckets({
            employee,
            month: filters.month,
            attendanceDates,
            weeklyDayOffDates,
            permissionAbsenceDates,
            branchAssignments
          });
        })
      );

      return summaryBuckets
        .flat()
        .filter((row) => !filters.branchId || row.branchId === filters.branchId)
        .sort((left, right) => {
          if (left.employeeId !== right.employeeId) {
            return left.employeeId - right.employeeId;
          }

          return (left.branchId ?? Number.MAX_SAFE_INTEGER) - (right.branchId ?? Number.MAX_SAFE_INTEGER);
        })
        .map((bucket) => ({
          employeeId: bucket.employeeId,
          employeeName: bucket.employeeName,
          branchId: bucket.branchId,
          branchName: bucket.branchName,
          month: bucket.month,
          attendanceDays: bucket.attendanceDates.size,
          weeklyDaysOff: bucket.weeklyDayOffDates.size,
          absenceWithPermission: bucket.permissionDates.size,
          absenceWithoutPermission: bucket.absenceWithoutPermission
        }));
    }
  };
}

function buildEmployeeSummaryBuckets(input: {
  employee: EmployeeSummaryBase;
  month: string;
  attendanceDates: AttendanceDateRecord[];
  weeklyDayOffDates: string[];
  permissionAbsenceDates: string[];
  branchAssignments: BranchAssignmentRecord[];
}) {
  const buckets = new Map<string, SummaryBucket>();
  const attendanceByDate = new Map<string, AttendanceDateRecord>();

  for (const attendance of input.attendanceDates) {
    attendanceByDate.set(attendance.date, attendance);
    getBucket(buckets, input.employee, input.month, attendance.branchId, attendance.branchName).attendanceDates.add(attendance.date);
  }

  for (const date of new Set(input.weeklyDayOffDates)) {
    const assignment = resolveAssignmentForDate(date, input.branchAssignments, input.employee);
    getBucket(buckets, input.employee, input.month, assignment.branchId, assignment.branchName).weeklyDayOffDates.add(date);
  }

  for (const date of new Set(input.permissionAbsenceDates)) {
    const assignment = resolveAssignmentForDate(date, input.branchAssignments, input.employee);
    getBucket(buckets, input.employee, input.month, assignment.branchId, assignment.branchName).permissionDates.add(date);
  }

  const coveredDates = new Set<string>([
    ...attendanceByDate.keys(),
    ...input.weeklyDayOffDates,
    ...input.permissionAbsenceDates
  ]);

  for (const date of listMonthDates(input.month)) {
    if (coveredDates.has(date)) {
      continue;
    }

    const assignment = resolveAssignmentForDate(date, input.branchAssignments, input.employee);
    getBucket(buckets, input.employee, input.month, assignment.branchId, assignment.branchName).absenceWithoutPermission += 1;
  }

  return Array.from(buckets.values()).map(stripBucketSets);
}

function getBucket(
  buckets: Map<string, SummaryBucket>,
  employee: EmployeeSummaryBase,
  month: string,
  branchId: number | null,
  branchName: string | null
) {
  const key = `${employee.id}:${branchId ?? "none"}`;
  const existing = buckets.get(key);

  if (existing) {
    return existing;
  }

  const created: SummaryBucket = {
    employeeId: employee.id,
    employeeName: employee.fullName,
    branchId,
    branchName,
    month,
    attendanceDates: new Set<string>(),
    weeklyDayOffDates: new Set<string>(),
    permissionDates: new Set<string>(),
    absenceWithoutPermission: 0
  };
  buckets.set(key, created);
  return created;
}

function resolveAssignmentForDate(
  date: string,
  assignments: BranchAssignmentRecord[],
  employee: EmployeeSummaryBase
) {
  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const sortedAssignments = assignments
    .slice()
    .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom));
  let match: BranchAssignmentRecord | null = null;

  for (let index = sortedAssignments.length - 1; index >= 0; index -= 1) {
    const assignment = sortedAssignments[index]!;
    const effectiveFrom = new Date(assignment.effectiveFrom);
    const effectiveTo = assignment.effectiveTo ? new Date(assignment.effectiveTo) : null;

    if (effectiveFrom <= dayStart && (!effectiveTo || effectiveTo > dayStart)) {
      match = assignment;
      break;
    }
  }

  if (match) {
    return {
      branchId: match.branchId,
      branchName: match.branchName
    };
  }

  return {
    branchId: employee.branchId,
    branchName: employee.branchName
  };
}

function listMonthDates(month: string) {
  const daysInMonth = getDaysInMonth(month);
  const values: string[] = [];

  for (let day = 1; day <= daysInMonth; day += 1) {
    values.push(`${month}-${String(day).padStart(2, "0")}`);
  }

  return values;
}

function getDaysInMonth(month: string) {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText);

  return new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
}

function stripBucketSets(bucket: SummaryBucket) {
  return bucket;
}
