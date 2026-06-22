import type { Express, NextFunction, Request, Response } from "express";
import {
  adminAttendanceCreateSchema,
  adminAttendanceDeleteSchema,
  adminAttendanceUpdateSchema,
  attendanceActionSchema,
  attendanceListFilterSchema
} from "@capella/shared";
import { z } from "zod";
import { getAppConfig } from "../../config/app-config";
import { createDatabaseClient } from "../../db";
import { getAuthenticatedAdmin, requireAdminSession } from "../auth/admin-session";
import { type createAuthService } from "../auth/service";
import { getAuthService } from "../auth/runtime";
import { createDrizzleAttendanceRepository } from "./repository";
import { createAttendanceService, type createAttendanceService as createAttendanceServiceFactory } from "./service";

type RegisterAttendanceRoutesOptions = {
  authService?: ReturnType<typeof createAuthService>;
  attendanceService?: ReturnType<typeof createAttendanceServiceFactory>;
};

type EmployeeActor = {
  id: number;
  role: "employee";
  name: string;
  phone: string;
};

export function registerAttendanceRoutes(
  app: Express,
  options: RegisterAttendanceRoutesOptions = {}
) {
  const employeeSessionMiddleware = requireEmployeeSession({
    authService: options.authService
  });
  const adminSessionMiddleware = requireAdminSession({
    authService: options.authService
  });
  const sessionIdParamsSchema = z.object({
    sessionId: z.coerce.number().int().positive()
  });

  app.get("/attendance/me", employeeSessionMiddleware, async (_request: Request, response: Response) => {
    const attendanceService = options.attendanceService ?? getAttendanceService();
    const employee = getAuthenticatedEmployee(response);
    const result = await attendanceService.getEmployeeAttendance(employee.id);

    if ("error" in result) {
      sendServiceError(response, result.error.code, result.error.message, result.error.details);
      return;
    }

    response.status(200).json({
      attendance: result
    });
  });

  app.post("/attendance/action", employeeSessionMiddleware, async (request: Request, response: Response) => {
    const parsed = attendanceActionSchema.safeParse(request.body);

    if (!parsed.success) {
      sendValidationError(response, parsed.error.flatten());
      return;
    }

    const attendanceService = options.attendanceService ?? getAttendanceService();
    const employee = getAuthenticatedEmployee(response);
    const result = await attendanceService.recordEmployeeAction(employee.id, parsed.data, {
      ipAddress: getRequestIpAddress(request)
    });

    if ("error" in result) {
      sendServiceError(response, result.error.code, result.error.message, result.error.details);
      return;
    }

    if ("blockedAttempt" in result) {
      response.status(422).json({
        error: {
          code: "ATTENDANCE_VALIDATION_FAILED",
          message: "Attendance validation failed",
          details: {
            failureReasons: result.blockedAttempt.failureReasons
          }
        },
        attendance: {
          employeeId: result.employeeId,
          currentAction: result.currentAction,
          openSession: result.openSession,
          todaySessions: result.todaySessions
        }
      });
      return;
    }

    response.status(200).json({
      attendance: result
    });
  });

  app.get("/admin/attendance", adminSessionMiddleware, async (request: Request, response: Response) => {
    const parsed = attendanceListFilterSchema.safeParse(request.query);

    if (!parsed.success) {
      sendValidationError(response, parsed.error.flatten());
      return;
    }

    const attendanceService = options.attendanceService ?? getAttendanceService();
    const sessions = await attendanceService.listAdminAttendance(parsed.data);

    response.status(200).json({ sessions });
  });

  app.post("/admin/attendance", adminSessionMiddleware, async (request: Request, response: Response) => {
    const parsed = adminAttendanceCreateSchema.safeParse(request.body);

    if (!parsed.success) {
      sendValidationError(response, parsed.error.flatten());
      return;
    }

    const attendanceService = options.attendanceService ?? getAttendanceService();
    const admin = getAuthenticatedAdmin(response);
    const result = await attendanceService.createAdminAttendance(parsed.data, admin.id);

    if ("error" in result) {
      sendAdminAttendanceError(response, result.error.code, result.error.message, result.error.details);
      return;
    }

    response.status(201).json({ session: result });
  });

  app.patch("/admin/attendance/:sessionId", adminSessionMiddleware, async (request: Request, response: Response) => {
    const params = sessionIdParamsSchema.safeParse(request.params);
    const body = adminAttendanceUpdateSchema.safeParse(request.body);

    if (!params.success) {
      sendValidationError(response, params.error.flatten());
      return;
    }

    if (!body.success) {
      sendValidationError(response, body.error.flatten());
      return;
    }

    const attendanceService = options.attendanceService ?? getAttendanceService();
    const admin = getAuthenticatedAdmin(response);
    const result = await attendanceService.updateAdminAttendance(params.data.sessionId, body.data, admin.id);

    if ("error" in result) {
      sendAdminAttendanceError(response, result.error.code, result.error.message, result.error.details);
      return;
    }

    response.status(200).json({ session: result });
  });

  app.delete("/admin/attendance/:sessionId", adminSessionMiddleware, async (request: Request, response: Response) => {
    const params = sessionIdParamsSchema.safeParse(request.params);
    const body = adminAttendanceDeleteSchema.safeParse(request.body);

    if (!params.success) {
      sendValidationError(response, params.error.flatten());
      return;
    }

    if (!body.success) {
      sendValidationError(response, body.error.flatten());
      return;
    }

    const attendanceService = options.attendanceService ?? getAttendanceService();
    const admin = getAuthenticatedAdmin(response);
    const result = await attendanceService.deleteAdminAttendance(params.data.sessionId, body.data.reason, admin.id);

    if (result && "error" in result) {
      sendAdminAttendanceError(response, result.error.code, result.error.message, result.error.details);
      return;
    }

    response.status(204).send();
  });
}

function requireEmployeeSession(options: {
  authService?: ReturnType<typeof createAuthService>;
}) {
  return async function employeeSessionMiddleware(request: Request, response: Response, next: NextFunction) {
    const config = getAppConfig();
    const sessionToken = request.cookies?.[config.auth.cookieName];

    if (typeof sessionToken !== "string" || sessionToken.length === 0) {
      response.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required",
          details: {}
        }
      });
      return;
    }

    const authService = options.authService ?? await getAuthService();
    const actor = await authService.getSessionActor(sessionToken);

    if (!actor) {
      response.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required",
          details: {}
        }
      });
      return;
    }

    if (actor.role !== "employee") {
      response.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "Employee access required",
          details: {}
        }
      });
      return;
    }

    response.locals.employeeActor = actor;
    next();
  };
}

function getAuthenticatedEmployee(response: Response) {
  return response.locals.employeeActor as EmployeeActor;
}

let attendanceService: ReturnType<typeof createAttendanceService> | null = null;

function getAttendanceService() {
  if (attendanceService) {
    return attendanceService;
  }

  const config = getAppConfig();
  const databaseClient = createDatabaseClient({
    databaseUrl: config.databaseUrl
  });
  const repository = createDrizzleAttendanceRepository({
    db: databaseClient.db
  });

  attendanceService = createAttendanceService({
    repository
  });

  return attendanceService;
}

function getRequestIpAddress(request: Request) {
  const forwardedFor = request.headers["x-forwarded-for"];

  if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
    return forwardedFor.split(",")[0]!.trim();
  }

  return request.ip || request.socket.remoteAddress || "";
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

function sendServiceError(
  response: Response,
  code: string,
  message: string,
  details: Record<string, unknown>
) {
  const status = code === "EMPLOYEE_NOT_FOUND" ? 404 : 409;

  response.status(status).json({
    error: {
      code,
      message,
      details
    }
  });
}

function sendAdminAttendanceError(
  response: Response,
  code: string,
  message: string,
  details: Record<string, unknown>
) {
  const status = code === "EMPLOYEE_NOT_FOUND" || code === "ATTENDANCE_NOT_FOUND" ? 404 : 409;

  response.status(status).json({
    error: {
      code,
      message,
      details
    }
  });
}
