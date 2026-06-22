export type AttendanceErrorResult = {
  error: {
    code:
      | "EMPLOYEE_NOT_FOUND"
      | "EMPLOYEE_BRANCH_NOT_ASSIGNED"
      | "BRANCH_NOT_READY"
      | "ATTENDANCE_ACTION_OUT_OF_ORDER"
      | "OVERNIGHT_ATTENDANCE_NOT_ALLOWED"
      | "ATTENDANCE_NOT_FOUND"
      | "ATTENDANCE_DATE_CONFLICT"
      | "MONTH_LOCKED";
    message: string;
    details: Record<string, unknown>;
  };
};

export function createEmployeeNotFoundError(): AttendanceErrorResult {
  return {
    error: {
      code: "EMPLOYEE_NOT_FOUND",
      message: "Employee not found",
      details: {}
    }
  };
}

export function createAttendanceNotFoundError(): AttendanceErrorResult {
  return {
    error: {
      code: "ATTENDANCE_NOT_FOUND",
      message: "Attendance record not found",
      details: {}
    }
  };
}

export function createMonthLockedError(): AttendanceErrorResult {
  return {
    error: {
      code: "MONTH_LOCKED",
      message: "The month is locked",
      details: {}
    }
  };
}

export function createOvernightNotAllowedError(): AttendanceErrorResult {
  return {
    error: {
      code: "OVERNIGHT_ATTENDANCE_NOT_ALLOWED",
      message: "Attendance check-out must happen on the same Cairo date",
      details: {}
    }
  };
}

export function createActionOutOfOrderError(message: string): AttendanceErrorResult {
  return {
    error: {
      code: "ATTENDANCE_ACTION_OUT_OF_ORDER",
      message,
      details: {}
    }
  };
}

export function createDateConflictError(conflictType: string): AttendanceErrorResult {
  return {
    error: {
      code: "ATTENDANCE_DATE_CONFLICT",
      message: "Attendance conflicts with existing day classification",
      details: {
        conflictType
      }
    }
  };
}
