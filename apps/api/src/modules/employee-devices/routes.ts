import type { Express, Request, Response } from "express";
import {
  employeeDeviceSetupCompletionSchema,
  employeeDeviceSetupLinkCreateSchema
} from "@capella/shared";
import { z } from "zod";
import { createDatabaseClient } from "../../db";
import { getAppConfig } from "../../config/app-config";
import { getAuthenticatedAdmin, requireAdminSession } from "../auth/admin-session";
import { createDrizzleAuditLogRepository } from "../audit-logs/repository";
import { createAuditLogService } from "../audit-logs/service";
import type { createAuthService } from "../auth/service";
import { createDrizzleEmployeeDeviceRepository } from "./repository";
import {
  createEmployeeDeviceService,
  type createEmployeeDeviceService as createEmployeeDeviceServiceFactory
} from "./service";

type RegisterEmployeeDevicesRoutesOptions = {
  authService?: ReturnType<typeof createAuthService>;
  employeeDeviceService?: ReturnType<typeof createEmployeeDeviceServiceFactory>;
};

export function registerEmployeeDevicesRoutes(
  app: Express,
  options: RegisterEmployeeDevicesRoutesOptions = {}
) {
  const adminSessionMiddleware = requireAdminSession({
    authService: options.authService
  });
  const employeeIdParamsSchema = z.object({
    employeeId: z.coerce.number().int().positive()
  });
  const deviceTokenParamsSchema = z.object({
    deviceToken: z.string().trim().min(1)
  });

  app.get("/employees/:employeeId/device", adminSessionMiddleware, async (request: Request, response: Response) => {
    const params = employeeIdParamsSchema.safeParse(request.params);

    if (!params.success) {
      sendValidationError(response, params.error.flatten());
      return;
    }

    const employeeDeviceService = options.employeeDeviceService ?? getEmployeeDeviceService();
    const result = await employeeDeviceService.getEmployeeDevice(params.data.employeeId);

    if ("error" in result) {
      response.status(404).json(result);
      return;
    }

    response.status(200).json({
      employeeDevice: result
    });
  });

  app.post("/employees/:employeeId/device/setup-links", adminSessionMiddleware, async (request: Request, response: Response) => {
    const params = employeeIdParamsSchema.safeParse(request.params);
    const body = employeeDeviceSetupLinkCreateSchema.safeParse(request.body);

    if (!params.success) {
      sendValidationError(response, params.error.flatten());
      return;
    }

    if (!body.success) {
      sendValidationError(response, body.error.flatten());
      return;
    }

    const employeeDeviceService = options.employeeDeviceService ?? getEmployeeDeviceService();
    const admin = getAuthenticatedAdmin(response);
    const result = await employeeDeviceService.createSetupLink(
      params.data.employeeId,
      body.data,
      admin.id
    );

    if ("error" in result) {
      response.status(404).json(result);
      return;
    }

    response.status(201).json({
      employeeDevice: result
    });
  });

  app.post("/employee-device-setup/:deviceToken/complete", async (request: Request, response: Response) => {
    const params = deviceTokenParamsSchema.safeParse(request.params);
    const body = employeeDeviceSetupCompletionSchema.safeParse(request.body);

    if (!params.success) {
      sendValidationError(response, params.error.flatten());
      return;
    }

    if (!body.success) {
      sendValidationError(response, body.error.flatten());
      return;
    }

    const employeeDeviceService = options.employeeDeviceService ?? getEmployeeDeviceService();
    const result = await employeeDeviceService.completeSetup(params.data.deviceToken, body.data);

    if ("error" in result) {
      response.status(result.error.code === "EMPLOYEE_DEVICE_SETUP_EXPIRED" ? 410 : 404).json(result);
      return;
    }

    response.status(200).json({
      employeeDevice: result
    });
  });

  app.delete("/employees/:employeeId/device", adminSessionMiddleware, async (request: Request, response: Response) => {
    const params = employeeIdParamsSchema.safeParse(request.params);

    if (!params.success) {
      sendValidationError(response, params.error.flatten());
      return;
    }

    const employeeDeviceService = options.employeeDeviceService ?? getEmployeeDeviceService();
    const admin = getAuthenticatedAdmin(response);
    const result = await employeeDeviceService.revokeDeviceAccess(params.data.employeeId, admin.id);

    if ("error" in result) {
      response.status(404).json(result);
      return;
    }

    response.status(200).json(result);
  });
}

let employeeDeviceService: ReturnType<typeof createEmployeeDeviceService> | null = null;

function getEmployeeDeviceService() {
  if (employeeDeviceService) {
    return employeeDeviceService;
  }

  const config = getAppConfig();
  const databaseClient = createDatabaseClient({
    databaseUrl: config.databaseUrl
  });

  const auditLogService = createAuditLogService({
    repository: createDrizzleAuditLogRepository({
      db: databaseClient.db
    })
  });

  employeeDeviceService = createEmployeeDeviceService({
    repository: createDrizzleEmployeeDeviceRepository({
      db: databaseClient.db
    }),
    auditLogService
  });

  return employeeDeviceService;
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
