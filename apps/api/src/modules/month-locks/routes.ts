import type { Express, Request, Response } from "express";
import { monthLockCreateSchema, monthLockListFilterSchema } from "@capella/shared";
import { getAppConfig } from "../../config/app-config";
import { createDatabaseClient } from "../../db";
import { getAuthenticatedAdmin, requireAdminSession } from "../auth/admin-session";
import type { createAuthService } from "../auth/service";
import { createDrizzleMonthLockRepository } from "./repository";
import {
  createMonthLockService,
  type createMonthLockService as createMonthLockServiceFactory
} from "./service";

type RegisterMonthLocksRoutesOptions = {
  authService?: ReturnType<typeof createAuthService>;
  monthLockService?: ReturnType<typeof createMonthLockServiceFactory>;
};

export function registerMonthLocksRoutes(app: Express, options: RegisterMonthLocksRoutesOptions = {}) {
  const adminSessionMiddleware = requireAdminSession({
    authService: options.authService
  });

  app.get("/month-locks", adminSessionMiddleware, async (request: Request, response: Response) => {
    const query = monthLockListFilterSchema.safeParse(request.query);

    if (!query.success) {
      sendValidationError(response, query.error.flatten());
      return;
    }

    const monthLockService = options.monthLockService ?? getMonthLockService();
    const monthLocks = await monthLockService.listMonthLocks(query.data);
    response.status(200).json({ monthLocks });
  });

  app.post("/month-locks", adminSessionMiddleware, async (request: Request, response: Response) => {
    const body = monthLockCreateSchema.safeParse(request.body);

    if (!body.success) {
      sendValidationError(response, body.error.flatten());
      return;
    }

    const monthLockService = options.monthLockService ?? getMonthLockService();
    const admin = getAuthenticatedAdmin(response);
    const result = await monthLockService.createMonthLock(body.data, admin.id);

    if ("error" in result) {
      response.status(409).json(result);
      return;
    }

    response.status(201).json({ monthLock: result });
  });
}

let monthLockService: ReturnType<typeof createMonthLockService> | null = null;

function getMonthLockService() {
  if (monthLockService) {
    return monthLockService;
  }

  const config = getAppConfig();
  const databaseClient = createDatabaseClient({
    databaseUrl: config.databaseUrl
  });
  const repository = createDrizzleMonthLockRepository({
    db: databaseClient.db
  });

  monthLockService = createMonthLockService({
    repository
  });

  return monthLockService;
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
