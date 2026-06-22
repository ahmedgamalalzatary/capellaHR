import type { Express, Request, Response } from "express";
import { monthlyAttendanceSummaryFilterSchema } from "@capella/shared";
import { getAppConfig } from "../../config/app-config";
import { createDatabaseClient } from "../../db";
import { requireAdminSession } from "../auth/admin-session";
import type { createAuthService } from "../auth/service";
import { createDrizzleReportsRepository } from "./repository";
import {
  createReportsService,
  type createReportsService as createReportsServiceFactory
} from "./service";

type RegisterReportsRoutesOptions = {
  authService?: ReturnType<typeof createAuthService>;
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
}

let reportsService: ReturnType<typeof createReportsService> | null = null;

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
