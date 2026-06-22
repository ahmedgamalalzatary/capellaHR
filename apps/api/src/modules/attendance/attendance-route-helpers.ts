import type { NextFunction, Request, Response } from "express";
import { getAppConfig } from "../../config/app-config";
import { createDatabaseClient } from "../../db";
import { type createAuthService } from "../auth/service";
import { getAuthService } from "../auth/runtime";
import { createDrizzleAttendanceRepository } from "./repository";
import { createAttendanceService, type createAttendanceService as createAttendanceServiceFactory } from "./service";

export type RegisterAttendanceRoutesOptions = {
  authService?: ReturnType<typeof createAuthService>;
  attendanceService?: ReturnType<typeof createAttendanceServiceFactory>;
};

export type EmployeeActor = {
  id: number;
  role: "employee";
  name: string;
  phone: string;
};

export function requireEmployeeSession(options: {
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

export function getAuthenticatedEmployee(response: Response) {
  return response.locals.employeeActor as EmployeeActor;
}

let attendanceService: ReturnType<typeof createAttendanceService> | null = null;

export function getAttendanceService() {
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

export function getRequestIpAddress(request: Request) {
  const forwardedFor = request.headers["x-forwarded-for"];

  if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
    return forwardedFor.split(",")[0]!.trim();
  }

  return request.ip || request.socket.remoteAddress || "";
}

export function sendValidationError(response: Response, details: Record<string, unknown>) {
  response.status(400).json({
    error: {
      code: "VALIDATION_ERROR",
      message: "Invalid request payload",
      details
    }
  });
}

export function sendServiceError(
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

export function sendAdminAttendanceError(
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
