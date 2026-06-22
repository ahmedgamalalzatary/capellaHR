import type { Express, Request, Response } from "express";
import { auditLogListFilterSchema } from "@capella/shared";
import { getAppConfig } from "../../config/app-config";
import { createDatabaseClient } from "../../db";
import { requireAdminSession } from "../auth/admin-session";
import type { createAuthService } from "../auth/service";
import { createDrizzleAuditLogRepository } from "./repository";
import {
  createAuditLogService,
  type createAuditLogService as createAuditLogServiceFactory
} from "./service";

type RegisterAuditLogsRoutesOptions = {
  authService?: ReturnType<typeof createAuthService>;
  auditLogService?: ReturnType<typeof createAuditLogServiceFactory>;
};

export function registerAuditLogsRoutes(app: Express, options: RegisterAuditLogsRoutesOptions = {}) {
  const adminSessionMiddleware = requireAdminSession({
    authService: options.authService
  });

  app.get("/audit-logs", adminSessionMiddleware, async (request: Request, response: Response) => {
    const query = auditLogListFilterSchema.safeParse(request.query);

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

    const auditLogService = options.auditLogService ?? getAuditLogService();
    const auditLogs = await auditLogService.listAuditLogs(query.data);
    response.status(200).json({ auditLogs });
  });
}

let auditLogService: ReturnType<typeof createAuditLogService> | null = null;

function getAuditLogService() {
  if (auditLogService) {
    return auditLogService;
  }

  const config = getAppConfig();
  const databaseClient = createDatabaseClient({
    databaseUrl: config.databaseUrl
  });
  const repository = createDrizzleAuditLogRepository({
    db: databaseClient.db
  });

  auditLogService = createAuditLogService({
    repository
  });

  return auditLogService;
}
