import type { Express, Request, Response } from "express";
import {
  branchCreateSchema,
  branchSearchSchema,
  branchSetupCompletionSchema,
  branchSetupLinkCreateSchema,
  branchUpdateSchema
} from "@capella/shared";
import { z } from "zod";
import { getAuthenticatedAdmin, requireAdminSession } from "../auth/admin-session";
import { createDrizzleAuditLogRepository } from "../audit-logs/repository";
import { createAuditLogService } from "../audit-logs/service";
import type { createAuthService } from "../auth/service";
import { createDatabaseClient } from "../../db";
import { getAppConfig } from "../../config/app-config";
import { createDrizzleBranchRepository } from "./repository";
import { createBranchService, type createBranchService as createBranchServiceFactory } from "./service";

type RegisterBranchesRoutesOptions = {
  authService?: ReturnType<typeof createAuthService>;
  branchService?: ReturnType<typeof createBranchServiceFactory>;
};

export function registerBranchesRoutes(app: Express, options: RegisterBranchesRoutesOptions = {}) {
  const adminSessionMiddleware = requireAdminSession({
    authService: options.authService
  });
  const branchIdParamsSchema = z.object({
    branchId: z.coerce.number().int().positive()
  });

  app.post("/branches", adminSessionMiddleware, async (request: Request, response: Response) => {
    const parsed = branchCreateSchema.safeParse(request.body);

    if (!parsed.success) {
      sendValidationError(response, parsed.error.flatten());
      return;
    }

    const branchService = options.branchService ?? getBranchService();
    const admin = getAuthenticatedAdmin(response);
    const branch = await branchService.createBranch(parsed.data, admin.id);

    response.status(201).json({ branch });
  });

  app.get("/branches", adminSessionMiddleware, async (request: Request, response: Response) => {
    const parsed = branchSearchSchema.safeParse(request.query);

    if (!parsed.success) {
      sendValidationError(response, parsed.error.flatten());
      return;
    }

    const branchService = options.branchService ?? getBranchService();
    const branches = await branchService.listBranches(parsed.data);

    response.status(200).json({ branches });
  });

  app.get("/branches/:branchId", adminSessionMiddleware, async (request: Request, response: Response) => {
    const parsed = branchIdParamsSchema.safeParse(request.params);

    if (!parsed.success) {
      sendValidationError(response, parsed.error.flatten());
      return;
    }

    const branchService = options.branchService ?? getBranchService();
    const result = await branchService.getBranchById(parsed.data.branchId);

    if ("error" in result) {
      response.status(404).json(result);
      return;
    }

    response.status(200).json({ branch: result });
  });

  app.patch("/branches/:branchId", adminSessionMiddleware, async (request: Request, response: Response) => {
    const params = branchIdParamsSchema.safeParse(request.params);
    const body = branchUpdateSchema.safeParse(request.body);

    if (!params.success) {
      sendValidationError(response, params.error.flatten());
      return;
    }

    if (!body.success) {
      sendValidationError(response, body.error.flatten());
      return;
    }

    const branchService = options.branchService ?? getBranchService();
    const admin = getAuthenticatedAdmin(response);
    const result = await branchService.updateBranch(params.data.branchId, body.data, admin.id);

    if ("error" in result) {
      response.status(404).json(result);
      return;
    }

    response.status(200).json({ branch: result });
  });

  app.get("/branches/:branchId/device", adminSessionMiddleware, async (request: Request, response: Response) => {
    const parsed = branchIdParamsSchema.safeParse(request.params);

    if (!parsed.success) {
      sendValidationError(response, parsed.error.flatten());
      return;
    }

    const branchService = options.branchService ?? getBranchService();
    const result = await branchService.getBranchDevice(parsed.data.branchId);

    if ("error" in result) {
      response.status(404).json(result);
      return;
    }

    response.status(200).json({ branchDevice: result });
  });

  app.post("/branches/:branchId/setup-links", adminSessionMiddleware, async (request: Request, response: Response) => {
    const params = branchIdParamsSchema.safeParse(request.params);
    const body = branchSetupLinkCreateSchema.safeParse(request.body);

    if (!params.success) {
      sendValidationError(response, params.error.flatten());
      return;
    }

    if (!body.success) {
      sendValidationError(response, body.error.flatten());
      return;
    }

    const branchService = options.branchService ?? getBranchService();
    const admin = getAuthenticatedAdmin(response);
    const result = await branchService.createSetupLink(params.data.branchId, body.data, admin.id);

    if ("error" in result) {
      response.status(404).json(result);
      return;
    }

    response.status(201).json({ branchDevice: result });
  });

  app.post("/branch-setup/:token/complete", async (request: Request, response: Response) => {
    const params = z.object({ token: z.string().trim().min(1) }).safeParse(request.params);
    const body = branchSetupCompletionSchema.safeParse(request.body);

    if (!params.success) {
      sendValidationError(response, params.error.flatten());
      return;
    }

    if (!body.success) {
      sendValidationError(response, body.error.flatten());
      return;
    }

    const branchService = options.branchService ?? getBranchService();
    const result = await branchService.completeSetup(params.data.token, body.data);

    if ("error" in result) {
      response.status(result.error.code === "BRANCH_SETUP_EXPIRED" ? 410 : 404).json(result);
      return;
    }

    response.status(200).json({ branchDevice: result });
  });

  app.delete("/branches/:branchId/setup-links", adminSessionMiddleware, async (request: Request, response: Response) => {
    const parsed = branchIdParamsSchema.safeParse(request.params);

    if (!parsed.success) {
      sendValidationError(response, parsed.error.flatten());
      return;
    }

    const branchService = options.branchService ?? getBranchService();
    const admin = getAuthenticatedAdmin(response);
    const result = await branchService.revokeSetupLink(parsed.data.branchId, admin.id);

    if ("error" in result) {
      response.status(404).json(result);
      return;
    }

    response.status(200).json(result);
  });
}

let branchService: ReturnType<typeof createBranchService> | null = null;

function getBranchService() {
  if (branchService) {
    return branchService;
  }

  const config = getAppConfig();
  const databaseClient = createDatabaseClient({
    databaseUrl: config.databaseUrl
  });
  const repository = createDrizzleBranchRepository({
    db: databaseClient.db
  });
  const auditLogService = createAuditLogService({
    repository: createDrizzleAuditLogRepository({
      db: databaseClient.db
    })
  });

  branchService = createBranchService({
    repository,
    auditLogService
  });

  return branchService;
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
