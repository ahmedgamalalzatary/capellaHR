import type {
  AttendanceListFilterInput,
  EmployeeListFilterInput,
  MonthlyAttendanceSummaryFilterInput
} from "@capella/shared";
import { APP_TIMEZONE } from "../../lib/constants";
import type { AdminAttendanceRecord } from "../attendance/service";
import type { EmployeeResponse } from "../employees/employee-mappers";
import type { MonthlyAttendanceSummaryRow } from "./service";
import type { PdfDocumentDefinition, PdfExportResult, PdfRenderer } from "./pdf-types";

type EmployeeExportService = {
  listEmployees(filters: EmployeeListFilterInput): Promise<{
    items: EmployeeResponse[];
  }>;
};

type AttendanceExportService = {
  listAdminAttendance(filters: AttendanceListFilterInput): Promise<{
    items: AdminAttendanceRecord[];
  }>;
};

type SummaryExportService = {
  getMonthlyAttendanceSummary(filters: MonthlyAttendanceSummaryFilterInput): Promise<MonthlyAttendanceSummaryRow[]>;
};

type CreatePdfExportServiceOptions = {
  renderer: PdfRenderer;
  employeeService: EmployeeExportService;
  attendanceService: AttendanceExportService;
  reportsService: SummaryExportService;
};

export { type PdfDocumentDefinition, type PdfExportResult, type PdfRenderer } from "./pdf-types";

export function createPdfExportService(options: CreatePdfExportServiceOptions) {
  return {
    async exportEmployeeListPdf(filters: EmployeeListFilterInput): Promise<PdfExportResult> {
      const employees = await options.employeeService.listEmployees(filters);
      const document: PdfDocumentDefinition = {
        title: "كشف الموظفين",
        subtitle: "التصفية الحالية",
        columns: ["الاسم", "الهاتف", "واتساب", "الفرع", "الحالة"],
        rows: employees.items.map((employee) => [
          employee.fullName,
          employee.primaryPhone,
          employee.whatsappPhone,
          employee.branchId === null ? "-" : String(employee.branchId),
          employee.softDeletedAt === null ? "نشط" : "محذوف"
        ]),
        emptyMessage: "لا توجد بيانات"
      };

      return {
        fileName: "employees.pdf",
        content: await options.renderer.render(document)
      };
    },

    async exportAttendanceListPdf(filters: AttendanceListFilterInput): Promise<PdfExportResult> {
      const sessions = await options.attendanceService.listAdminAttendance(filters);
      const document: PdfDocumentDefinition = {
        title: "كشف الحضور",
        subtitle: "التصفية الحالية",
        columns: ["الموظف", "الفرع", "الحالة", "دخول", "خروج"],
        rows: sessions.items.map((session) => [
          session.employeeName,
          String(session.branchId),
          session.status === "completed" ? "مكتمل" : "مفتوح",
          formatDateTime(session.checkInAtUtc),
          session.checkOutAtUtc ? formatDateTime(session.checkOutAtUtc) : "-"
        ]),
        emptyMessage: "لا توجد بيانات"
      };

      return {
        fileName: "attendance.pdf",
        content: await options.renderer.render(document)
      };
    },

    async exportMonthlyAttendanceSummaryPdf(filters: MonthlyAttendanceSummaryFilterInput): Promise<PdfExportResult> {
      const summaries = await options.reportsService.getMonthlyAttendanceSummary(filters);
      const document: PdfDocumentDefinition = {
        title: "الملخص الشهري",
        subtitle: filters.month,
        columns: ["الموظف", "الفرع", "حضور", "راحة", "مأذون", "غياب"],
        rows: summaries.map((summary) => [
          summary.employeeName,
          summary.branchName ?? "-",
          String(summary.attendanceDays),
          String(summary.weeklyDaysOff),
          String(summary.absenceWithPermission),
          String(summary.absenceWithoutPermission)
        ]),
        emptyMessage: "لا توجد بيانات"
      };

      return {
        fileName: `monthly-attendance-summary-${filters.month}.pdf`,
        content: await options.renderer.render(document)
      };
    }
  };
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("ar-EG", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(value);
}
