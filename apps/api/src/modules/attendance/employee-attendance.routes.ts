import type { Express, RequestHandler, Request, Response } from "express";
import { attendanceActionSchema } from "@capella/shared";
import {
  type RegisterAttendanceRoutesOptions,
  getAttendanceService,
  getAuthenticatedEmployee,
  getRequestIpAddress,
  sendServiceError,
  sendValidationError
} from "./attendance-route-helpers";

export function registerEmployeeAttendanceRoutes(
  app: Express,
  options: RegisterAttendanceRoutesOptions,
  employeeSessionMiddleware: RequestHandler
) {
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
}
