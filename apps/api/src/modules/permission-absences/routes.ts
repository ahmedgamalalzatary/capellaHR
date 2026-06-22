import type { Express, Request, Response } from "express";
import {
  permissionAbsenceCreateSchema,
  permissionAbsenceListFilterSchema,
  permissionAbsenceUpdateSchema
} from "@capella/shared";
import { z } from "zod";
import { getAppConfig } from "../../config/app-config";
import { createDatabaseClient } from "../../db";
import { getAuthenticatedAdmin, requireAdminSession } from "../auth/admin-session";
import type { createAuthService } from "../auth/service";
import { createDrizzlePermissionAbsenceRepository } from "./repository";
import {
  createPermissionAbsenceService,
  type createPermissionAbsenceService as createPermissionAbsenceServiceFactory
} from "./service";

type RegisterPermissionAbsenceRoutesOptions = {
  authService?: ReturnType<typeof createAuthService>;
  permissionAbsenceService?: ReturnType<typeof createPermissionAbsenceServiceFactory>;
};

export function registerPermissionAbsenceRoutes(
  app: Express,
  options: RegisterPermissionAbsenceRoutesOptions = {}
) {
  const adminSessionMiddleware = requireAdminSession({
    authService: options.authService
  });
  const employeeIdParamsSchema = z.object({
    employeeId: z.coerce.number().int().positive()
  });
  const absenceIdParamsSchema = z.object({
    absenceId: z.coerce.number().int().positive()
  });

  app.get("/employees/:employeeId/permission-absences", adminSessionMiddleware, async (request: Request, response: Response) => {
    const params = employeeIdParamsSchema.safeParse(request.params);
    const query = permissionAbsenceListFilterSchema.safeParse(request.query);

    if (!params.success) {
      sendValidationError(response, params.error.flatten());
      return;
    }

    if (!query.success) {
      sendValidationError(response, query.error.flatten());
      return;
    }

    const permissionAbsenceService = options.permissionAbsenceService ?? getPermissionAbsenceService();
    const result = await permissionAbsenceService.listAbsences(params.data.employeeId, query.data);

    if ("error" in result) {
      response.status(404).json(result);
      return;
    }

    response.status(200).json({ absences: result });
  });

  app.post("/employees/:employeeId/permission-absences", adminSessionMiddleware, async (request: Request, response: Response) => {
    const params = employeeIdParamsSchema.safeParse(request.params);
    const body = permissionAbsenceCreateSchema.safeParse(request.body);

    if (!params.success) {
      sendValidationError(response, params.error.flatten());
      return;
    }

    if (!body.success) {
      sendValidationError(response, body.error.flatten());
      return;
    }

    const permissionAbsenceService = options.permissionAbsenceService ?? getPermissionAbsenceService();
    const admin = getAuthenticatedAdmin(response);
    const result = await permissionAbsenceService.createAbsence(
      params.data.employeeId,
      body.data,
      admin.id
    );

    if ("error" in result) {
      response.status(result.error.code === "EMPLOYEE_NOT_FOUND" ? 404 : 409).json(result);
      return;
    }

    response.status(201).json({ absence: result });
  });

  app.patch("/permission-absences/:absenceId", adminSessionMiddleware, async (request: Request, response: Response) => {
    const params = absenceIdParamsSchema.safeParse(request.params);
    const body = permissionAbsenceUpdateSchema.safeParse(request.body);

    if (!params.success) {
      sendValidationError(response, params.error.flatten());
      return;
    }

    if (!body.success) {
      sendValidationError(response, body.error.flatten());
      return;
    }

    const permissionAbsenceService = options.permissionAbsenceService ?? getPermissionAbsenceService();
    const admin = getAuthenticatedAdmin(response);
    const result = await permissionAbsenceService.updateAbsence(
      params.data.absenceId,
      body.data,
      admin.id
    );

    if ("error" in result) {
      response.status(result.error.code === "PERMISSION_ABSENCE_NOT_FOUND" ? 404 : 409).json(result);
      return;
    }

    response.status(200).json({ absence: result });
  });
}

let permissionAbsenceService: ReturnType<typeof createPermissionAbsenceService> | null = null;

function getPermissionAbsenceService() {
  if (permissionAbsenceService) {
    return permissionAbsenceService;
  }

  const config = getAppConfig();
  const databaseClient = createDatabaseClient({
    databaseUrl: config.databaseUrl
  });
  const repository = createDrizzlePermissionAbsenceRepository({
    db: databaseClient.db
  });

  permissionAbsenceService = createPermissionAbsenceService({
    repository
  });

  return permissionAbsenceService;
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
