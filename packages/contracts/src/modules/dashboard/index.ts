export interface DashboardEmployeeRef {
  employeeId: number;
  employeeCode: number;
  employeeName: string;
  branchId: number;
  branchName: string;
}

export interface DashboardAttendanceItem extends DashboardEmployeeRef {
  sessionId: number;
  attendanceDate: string;
  checkInAt: string;
}

export type DashboardNotCheckedInItem = DashboardEmployeeRef;

export interface DashboardDailyRecordItem extends DashboardEmployeeRef {
  id: number;
  attendanceDate: string;
  status: 'absence' | 'weekly_day_off';
  occurredAt: string;
}

export interface DashboardDeniedAttemptItem {
  id: number;
  claimedEmployeeCode: number;
  employeeId: number | null;
  employeeName: string | null;
  eventType: 'check_in' | 'check_out';
  source: 'personal_device' | 'branch_device';
  failureReason: string;
  suspicious: boolean;
  occurredAt: string;
}

export interface DashboardAutomaticTimeoutItem extends DashboardEmployeeRef {
  sessionId: number;
  attendanceDate: string;
  checkInAt: string;
  automaticTimeoutAt: string;
  correctedAt: string | null;
}

export interface DashboardDevicePairingItem {
  id: number;
  kind: 'pairing' | 'replacement';
  assignmentType: 'employee' | 'branch';
  assignmentId: number;
  assignmentName: string;
  createdAt: string;
}

export interface DashboardPayrollBlockerItem extends DashboardEmployeeRef {
  reasons: string[];
}

export interface DashboardPdfExportItem {
  id: number;
  reportType: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  attemptCount: number;
  retryCount: number;
  failureReason: string | null;
  queuedAt: string;
  updatedAt: string;
}

export interface DashboardSnapshotDto {
  generatedAt: string;
  cairoDate: string;
  payrollMonth: string;
  currentlyCheckedIn: { total: number; items: DashboardAttendanceItem[] };
  previousDayOpen: { total: number; items: DashboardAttendanceItem[] };
  notCheckedIn: { total: number; items: DashboardNotCheckedInItem[] };
  latestDailyRecords: { items: DashboardDailyRecordItem[] };
  attendanceReview: {
    unresolvedTotal: number;
    flaggedTotal: number;
    items: DashboardDeniedAttemptItem[];
  };
  automaticTimeouts: { total: number; items: DashboardAutomaticTimeoutItem[] };
  devicePairings: {
    pendingTotal: number;
    replacementTotal: number;
    items: DashboardDevicePairingItem[];
  };
  payrollBlockers: { total: number; items: DashboardPayrollBlockerItem[] };
  pdfExports: {
    queued: number;
    processing: number;
    completed: number;
    failed: number;
    items: DashboardPdfExportItem[];
  };
}
