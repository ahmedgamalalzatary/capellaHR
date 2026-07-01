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
    pagination?: { totalPages: number };
  }>;
};

type AttendanceExportService = {
  listAdminAttendance(filters: AttendanceListFilterInput): Promise<{
    items: AdminAttendanceRecord[];
    pagination?: { totalPages: number };
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

const PDF_EXPORT_PAGE_SIZE = 100;
const PDF_EXPORT_MAX_ROWS = 5000;
const PDF_EXPORT_MAX_PAGES = Math.ceil(PDF_EXPORT_MAX_ROWS / PDF_EXPORT_PAGE_SIZE);
const PDF_EXPORT_PAGE_BATCH_SIZE = 5;

export { type PdfDocumentDefinition, type PdfExportResult, type PdfRenderer } from "./pdf-types";

export function createPdfExportService(options: CreatePdfExportServiceOptions) {
  return {
    async exportEmployeeListPdf(filters: EmployeeListFilterInput): Promise<PdfExportResult> {
      const employees = await listAllPages(filters, (pageFilters) =>
        options.employeeService.listEmployees(pageFilters)
      );
      const document: PdfDocumentDefinition = {
        title: "كشف الموظفين",
        subtitle: "التصفية الحالية",
        columns: ["الاسم", "الهاتف", "واتساب", "الفرع", "الحالة"],
        rows: employees.map((employee) => [
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
      const sessions = await listAllPages(filters, (pageFilters) =>
        options.attendanceService.listAdminAttendance(pageFilters)
      );
      const document: PdfDocumentDefinition = {
        title: "كشف الحضور",
        subtitle: "التصفية الحالية",
        columns: ["الموظف", "الفرع", "الحالة", "دخول", "خروج"],
        rows: sessions.map((session) => [
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

async function listAllPages<TFilters extends { page: number; pageSize: number }, TItem>(
  filters: TFilters,
  loadPage: (filters: TFilters) => Promise<{ items: TItem[]; pagination?: { totalPages: number } }>
) {
  const pageSize = PDF_EXPORT_PAGE_SIZE;
  const firstPage = await loadPage({ ...filters, page: 1, pageSize });
  const items = [...firstPage.items];
  const totalPages = firstPage.pagination?.totalPages ?? 1;

  if (totalPages > PDF_EXPORT_MAX_PAGES) {
    throw new Error(`PDF export is limited to ${PDF_EXPORT_MAX_ROWS} rows`);
  }

  for (let page = 2; page <= totalPages; page += PDF_EXPORT_PAGE_BATCH_SIZE) {
    const pages = Array.from(
      { length: Math.min(PDF_EXPORT_PAGE_BATCH_SIZE, totalPages - page + 1) },
      (_, index) => page + index
    );
    const nextPages = await Promise.all(
      pages.map((pageNumber) => loadPage({ ...filters, page: pageNumber, pageSize }))
    );
    for (const nextPage of nextPages) {
      items.push(...nextPage.items);
    }
  }

  return items;
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
