import type { Express, RequestHandler, Request, Response } from "express";
import {
  adminAttendanceCreateSchema,
  adminAttendanceDeleteSchema,
  adminAttendanceUpdateSchema,
  attendanceListFilterSchema
} from "@capella/shared";
import { z } from "zod";
import { getAuthenticatedAdmin } from "../auth/admin-session";
import {
  type RegisterAttendanceRoutesOptions,
  getAttendanceService,
  sendAdminAttendanceError,
  sendValidationError
} from "./attendance-route-helpers";

const sessionIdParamsSchema = z.object({
  sessionId: z.coerce.number().int().positive()
});

export function registerAdminAttendanceRoutes(
  app: Express,
  options: RegisterAttendanceRoutesOptions,
  adminSessionMiddleware: RequestHandler
) {
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
