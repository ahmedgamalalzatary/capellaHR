import type { Express, Request, Response } from "express";
import {
  attendanceListFilterSchema,
  employeeListFilterSchema,
  monthlyAttendanceSummaryFilterSchema
} from "@capella/shared";
import { getAppConfig } from "../../config/app-config";
import { createDatabaseClient } from "../../db";
import { getAttendanceService } from "../attendance/attendance-route-helpers";
import { requireAdminSession } from "../auth/admin-session";
import type { createAuthService } from "../auth/service";
import { getEmployeeService } from "../employees/employee-route-helpers";
import type { createAttendanceService } from "../attendance/service";
import type { createEmployeeService } from "../employees/service";
import { createPlaywrightPdfRenderer } from "./pdf-renderer";
import {
  createPdfExportService,
  type createPdfExportService as createPdfExportServiceFactory
} from "./pdf-export.service";
import { createDrizzleReportsRepository } from "./repository";
import {
  createReportsService,
  type createReportsService as createReportsServiceFactory
} from "./service";

type RegisterReportsRoutesOptions = {
  authService?: ReturnType<typeof createAuthService>;
  attendanceService?: ReturnType<typeof createAttendanceService>;
  employeeService?: ReturnType<typeof createEmployeeService>;
  pdfExportService?: ReturnType<typeof createPdfExportServiceFactory>;
  reportsService?: ReturnType<typeof createReportsServiceFactory>;
};

export function registerReportsRoutes(app: Express, options: RegisterReportsRoutesOptions = {}) {
  const adminSessionMiddleware = requireAdminSession({
    authService: options.authService
  });

  app.get("/reports/monthly-attendance-summary", adminSessionMiddleware, async (request: Request, response: Response) => {
    const query = monthlyAttendanceSummaryFilterSchema.safeParse(request.query);

    if (!query.success) {
      response.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request payload",
          details: query.error.flatten()
        }
      });
      return;
    }

    const reportsService = options.reportsService ?? getReportsService();
    const summaries = await reportsService.getMonthlyAttendanceSummary(query.data);

    response.status(200).json({ summaries });
  });

  app.get("/reports/employees/export.pdf", adminSessionMiddleware, async (request: Request, response: Response) => {
    const query = employeeListFilterSchema.safeParse(request.query);

    if (!query.success) {
      response.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request payload",
          details: query.error.flatten()
        }
      });
      return;
    }

    const pdfExportService = options.pdfExportService ?? getPdfExportService(options);
    const exported = await pdfExportService.exportEmployeeListPdf(query.data);
    sendPdf(response, exported.fileName, exported.content);
  });

  app.get("/reports/attendance/export.pdf", adminSessionMiddleware, async (request: Request, response: Response) => {
    const query = attendanceListFilterSchema.safeParse(request.query);

    if (!query.success) {
      response.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request payload",
          details: query.error.flatten()
        }
      });
      return;
    }

    const pdfExportService = options.pdfExportService ?? getPdfExportService(options);
    const exported = await pdfExportService.exportAttendanceListPdf(query.data);
    sendPdf(response, exported.fileName, exported.content);
  });

  app.get("/reports/monthly-attendance-summary/export.pdf", adminSessionMiddleware, async (request: Request, response: Response) => {
    const query = monthlyAttendanceSummaryFilterSchema.safeParse(request.query);

    if (!query.success) {
      response.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request payload",
          details: query.error.flatten()
        }
      });
      return;
    }

    const pdfExportService = options.pdfExportService ?? getPdfExportService(options);
    const exported = await pdfExportService.exportMonthlyAttendanceSummaryPdf(query.data);
    sendPdf(response, exported.fileName, exported.content);
  });
}

let reportsService: ReturnType<typeof createReportsService> | null = null;
let pdfExportService: ReturnType<typeof createPdfExportService> | null = null;

function getReportsService() {
  if (reportsService) {
    return reportsService;
  }

  const config = getAppConfig();
  const databaseClient = createDatabaseClient({
    databaseUrl: config.databaseUrl
  });
  const repository = createDrizzleReportsRepository({
    db: databaseClient.db
  });

  reportsService = createReportsService({
    repository
  });

  return reportsService;
}

function getPdfExportService(options: RegisterReportsRoutesOptions) {
  if (pdfExportService) {
    return pdfExportService;
  }

  const reportsRuntimeService = options.reportsService ?? getReportsService();
  const employeeService = options.employeeService ?? getEmployeeService();
  const attendanceService = options.attendanceService ?? getAttendanceService();

  pdfExportService = createPdfExportService({
    renderer: createPlaywrightPdfRenderer(),
    employeeService,
    attendanceService,
    reportsService: reportsRuntimeService
  });

  return pdfExportService;
}

function sendPdf(response: Response, fileName: string, content: Buffer) {
  response
    .status(200)
    .set("Content-Type", "application/pdf")
    .set("Content-Disposition", `attachment; filename="${fileName}"`)
    .send(content);
}
