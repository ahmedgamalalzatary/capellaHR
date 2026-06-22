import { describe, expect, it } from "vitest";
import type { AttendanceListFilterInput, EmployeeListFilterInput, MonthlyAttendanceSummaryFilterInput } from "@capella/shared";
import {
  createPdfExportService,
  type PdfDocumentDefinition,
  type PdfRenderer
} from "../../../../src/modules/reports/pdf-export.service";
import type { AdminAttendanceRecord } from "../../../../src/modules/attendance/service";
import type { MonthlyAttendanceSummaryRow } from "../../../../src/modules/reports/service";

class InMemoryPdfRenderer implements PdfRenderer {
  documents: PdfDocumentDefinition[] = [];

  async render(document: PdfDocumentDefinition) {
    this.documents.push(document);
    return Buffer.from(`pdf:${document.title}`, "utf8");
  }
}

describe("reports pdf export service", () => {
  it("exports the current filtered employee list as a pdf document", async () => {
    const renderer = new InMemoryPdfRenderer();
    const filters: EmployeeListFilterInput = {
      search: "Mina",
      branchId: 2,
      status: "active"
    };
    const service = createPdfExportService({
      renderer,
      employeeService: {
        async listEmployees(receivedFilters: EmployeeListFilterInput) {
          expect(receivedFilters).toEqual(filters);

          return [
            {
              id: 1,
              fullName: "Mina Adel",
              primaryPhone: "01012345678",
              whatsappPhone: "01012345678",
              email: "mina@capella.eg",
              branchId: 2,
              age: 28,
              address: "Nasr City",
              currentMonthlySalary: "6500",
              softDeletedAt: null
            }
          ];
        }
      },
      attendanceService: {
        async listAdminAttendance() {
          return [];
        }
      },
      reportsService: {
        async getMonthlyAttendanceSummary() {
          return [];
        }
      }
    });

    const result = await service.exportEmployeeListPdf(filters);

    expect(result.fileName).toBe("employees.pdf");
    expect(result.content).toEqual(Buffer.from("pdf:كشف الموظفين", "utf8"));
    expect(renderer.documents).toEqual([
      {
        title: "كشف الموظفين",
        subtitle: "التصفية الحالية",
        columns: ["الاسم", "الهاتف", "واتساب", "الفرع", "الحالة"],
        rows: [["Mina Adel", "01012345678", "01012345678", "2", "نشط"]],
        emptyMessage: "لا توجد بيانات"
      }
    ]);
  });

  it("exports the current filtered attendance list as a pdf document", async () => {
    const renderer = new InMemoryPdfRenderer();
    const filters: AttendanceListFilterInput = {
      branchId: 2,
      status: "completed",
      sortBy: "check_in_at",
      sortDirection: "desc"
    };
    const service = createPdfExportService({
      renderer,
      employeeService: {
        async listEmployees() {
          return [];
        }
      },
      attendanceService: {
        async listAdminAttendance(receivedFilters: AttendanceListFilterInput) {
          expect(receivedFilters).toEqual(filters);

          return [
            createAttendanceRecord({
              id: 10,
              employeeId: 1,
              employeeName: "Mina Adel",
              branchId: 2,
              status: "completed",
              checkInAtUtc: new Date("2026-06-12T05:00:00.000Z"),
              checkOutAtUtc: new Date("2026-06-12T14:00:00.000Z")
            })
          ];
        }
      },
      reportsService: {
        async getMonthlyAttendanceSummary() {
          return [];
        }
      }
    });

    const result = await service.exportAttendanceListPdf(filters);

    expect(result.fileName).toBe("attendance.pdf");
    expect(result.content).toEqual(Buffer.from("pdf:كشف الحضور", "utf8"));
    expect(renderer.documents[0]).toMatchObject({
      title: "كشف الحضور",
      subtitle: "التصفية الحالية",
      columns: ["الموظف", "الفرع", "الحالة", "دخول", "خروج"]
    });
    expect(renderer.documents[0]?.rows).toHaveLength(1);
  });

  it("exports the monthly summary as a pdf document", async () => {
    const renderer = new InMemoryPdfRenderer();
    const filters: MonthlyAttendanceSummaryFilterInput = {
      month: "2026-06",
      branchId: 2
    };
    const summaryRows: MonthlyAttendanceSummaryRow[] = [
      {
        employeeId: 1,
        employeeName: "Mina Adel",
        branchId: 2,
        branchName: "Nasr City",
        month: "2026-06",
        attendanceDays: 10,
        weeklyDaysOff: 4,
        absenceWithPermission: 2,
        absenceWithoutPermission: 14
      }
    ];
    const service = createPdfExportService({
      renderer,
      employeeService: {
        async listEmployees() {
          return [];
        }
      },
      attendanceService: {
        async listAdminAttendance() {
          return [];
        }
      },
      reportsService: {
        async getMonthlyAttendanceSummary(receivedFilters: MonthlyAttendanceSummaryFilterInput) {
          expect(receivedFilters).toEqual(filters);
          return summaryRows;
        }
      }
    });

    const result = await service.exportMonthlyAttendanceSummaryPdf(filters);

    expect(result.fileName).toBe("monthly-attendance-summary-2026-06.pdf");
    expect(result.content).toEqual(Buffer.from("pdf:الملخص الشهري", "utf8"));
    expect(renderer.documents).toEqual([
      {
        title: "الملخص الشهري",
        subtitle: "2026-06",
        columns: ["الموظف", "الفرع", "حضور", "راحة", "مأذون", "غياب"],
        rows: [["Mina Adel", "Nasr City", "10", "4", "2", "14"]],
        emptyMessage: "لا توجد بيانات"
      }
    ]);
  });
});

function createAttendanceRecord(overrides: Partial<AdminAttendanceRecord>): AdminAttendanceRecord {
  return {
    id: 1,
    employeeId: 1,
    employeeName: "Mina Adel",
    branchId: 2,
    status: "completed",
    checkInAtUtc: new Date("2026-06-01T05:00:00.000Z"),
    checkOutAtUtc: new Date("2026-06-01T14:00:00.000Z"),
    checkInLatitude: 0,
    checkInLongitude: 0,
    checkInIpAddress: "127.0.0.1",
    deviceId: "device-1",
    branchPolicySnapshot: {},
    adminReason: null,
    createdByAdminId: null,
    updatedByAdminId: null,
    ...overrides
  };
}
