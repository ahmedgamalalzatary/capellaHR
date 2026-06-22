import type { Express, Request, Response } from "express";
import {
  weeklyDayOffAssignmentCreateSchema,
  weeklyDayOffAssignmentListFilterSchema,
  weeklyDayOffAssignmentUpdateSchema
} from "@capella/shared";
import { z } from "zod";
import { getAppConfig } from "../../config/app-config";
import { createDatabaseClient } from "../../db";
import { getAuthenticatedAdmin, requireAdminSession } from "../auth/admin-session";
import { createDrizzleAuditLogRepository } from "../audit-logs/repository";
import { createAuditLogService } from "../audit-logs/service";
import type { createAuthService } from "../auth/service";
import { createDrizzleWeeklyDayOffRepository } from "./repository";
import {
  createWeeklyDayOffService,
  type createWeeklyDayOffService as createWeeklyDayOffServiceFactory
} from "./service";

type RegisterWeeklyDayOffRoutesOptions = {
  authService?: ReturnType<typeof createAuthService>;
  weeklyDayOffService?: ReturnType<typeof createWeeklyDayOffServiceFactory>;
};

export function registerWeeklyDayOffRoutes(
  app: Express,
  options: RegisterWeeklyDayOffRoutesOptions = {}
) {
  const adminSessionMiddleware = requireAdminSession({
    authService: options.authService
  });
  const employeeIdParamsSchema = z.object({
    employeeId: z.coerce.number().int().positive()
  });
  const assignmentIdParamsSchema = z.object({
    assignmentId: z.coerce.number().int().positive()
  });

  app.get("/employees/:employeeId/weekly-day-offs", adminSessionMiddleware, async (request: Request, response: Response) => {
    const params = employeeIdParamsSchema.safeParse(request.params);
    const query = weeklyDayOffAssignmentListFilterSchema.safeParse(request.query);

    if (!params.success) {
      sendValidationError(response, params.error.flatten());
      return;
    }

    if (!query.success) {
      sendValidationError(response, query.error.flatten());
      return;
    }

    const weeklyDayOffService = options.weeklyDayOffService ?? getWeeklyDayOffService();
    const result = await weeklyDayOffService.listAssignments(params.data.employeeId, query.data);

    if ("error" in result) {
      response.status(404).json(result);
      return;
    }

    response.status(200).json({ assignments: result });
  });

  app.post("/employees/:employeeId/weekly-day-offs", adminSessionMiddleware, async (request: Request, response: Response) => {
    const params = employeeIdParamsSchema.safeParse(request.params);
    const body = weeklyDayOffAssignmentCreateSchema.safeParse(request.body);

    if (!params.success) {
      sendValidationError(response, params.error.flatten());
      return;
    }

    if (!body.success) {
      sendValidationError(response, body.error.flatten());
      return;
    }

    const weeklyDayOffService = options.weeklyDayOffService ?? getWeeklyDayOffService();
    const admin = getAuthenticatedAdmin(response);
    const result = await weeklyDayOffService.createAssignment(params.data.employeeId, body.data, admin.id);

    if ("error" in result) {
      response.status(result.error.code === "EMPLOYEE_NOT_FOUND" ? 404 : 409).json(result);
      return;
    }

    response.status(201).json({ assignment: result });
  });

  app.patch("/weekly-day-offs/:assignmentId", adminSessionMiddleware, async (request: Request, response: Response) => {
    const params = assignmentIdParamsSchema.safeParse(request.params);
    const body = weeklyDayOffAssignmentUpdateSchema.safeParse(request.body);

    if (!params.success) {
      sendValidationError(response, params.error.flatten());
      return;
    }

    if (!body.success) {
      sendValidationError(response, body.error.flatten());
      return;
    }

    const weeklyDayOffService = options.weeklyDayOffService ?? getWeeklyDayOffService();
    const admin = getAuthenticatedAdmin(response);
    const result = await weeklyDayOffService.updateAssignment(params.data.assignmentId, body.data, admin.id);

    if ("error" in result) {
      response.status(result.error.code === "WEEKLY_DAY_OFF_NOT_FOUND" ? 404 : 409).json(result);
      return;
    }

    response.status(200).json({ assignment: result });
  });
}

let weeklyDayOffService: ReturnType<typeof createWeeklyDayOffService> | null = null;

function getWeeklyDayOffService() {
  if (weeklyDayOffService) {
    return weeklyDayOffService;
  }

  const config = getAppConfig();
  const databaseClient = createDatabaseClient({
    databaseUrl: config.databaseUrl
  });
  const repository = createDrizzleWeeklyDayOffRepository({
    db: databaseClient.db
  });
  const auditLogService = createAuditLogService({
    repository: createDrizzleAuditLogRepository({
      db: databaseClient.db
    })
  });

  weeklyDayOffService = createWeeklyDayOffService({
    repository,
    auditLogService
  });

  return weeklyDayOffService;
}

function sendValidationError(response: Response, details: Record<string, unknown>) {
  response.status(400).json({
    error: {
      code: "VALIDATION_ERROR",
      message: "Invalid request payload",
      details
    }
  });
}
