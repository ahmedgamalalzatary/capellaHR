import type { Express, RequestHandler, Request, Response } from "express";
import { z } from "zod";
import { getAuthenticatedAdmin } from "../auth/admin-session";
import {
  type RegisterEmployeesRoutesOptions,
  employeeFileTypeParamsSchema,
  employeeIdParamsSchema,
  getEmployeeService,
  mapUploadedFile,
  sendValidationError
} from "./employee-route-helpers";

export function registerEmployeeFileRoutes(
  app: Express,
  options: RegisterEmployeesRoutesOptions,
  adminSessionMiddleware: RequestHandler,
  uploadSingleFile: RequestHandler
) {
  app.get("/employees/:employeeId/files", adminSessionMiddleware, async (request: Request, response: Response) => {
    const parsed = employeeIdParamsSchema.safeParse(request.params);

    if (!parsed.success) {
      sendValidationError(response, parsed.error.flatten());
      return;
    }

    const employeeService = options.employeeService ?? getEmployeeService();
    const result = await employeeService.listEmployeeFiles(parsed.data.employeeId);

    response.status(200).json(result);
  });

  app.get("/employees/:employeeId/files/:fileId", adminSessionMiddleware, async (request: Request, response: Response) => {
    const parsed = z.object({
      employeeId: z.coerce.number().int().positive(),
      fileId: z.coerce.number().int().positive()
    }).safeParse(request.params);

    if (!parsed.success) {
      sendValidationError(response, parsed.error.flatten());
      return;
    }

    const employeeService = options.employeeService ?? getEmployeeService();
    const result = await employeeService.getEmployeeFile(parsed.data.employeeId, parsed.data.fileId);

    if ("error" in result) {
      response.status(404).json(result);
      return;
    }

    response.setHeader("Content-Type", result.file.mimeType);
    response.status(200).send(result.content);
  });

  app.put("/employees/:employeeId/files/:fileType", adminSessionMiddleware, uploadSingleFile, async (request: Request, response: Response) => {
    const parsed = employeeFileTypeParamsSchema.safeParse(request.params);

    if (!parsed.success) {
      sendValidationError(response, parsed.error.flatten());
      return;
    }

    if (!request.file) {
      response.status(400).json({
        error: {
          code: "MISSING_EMPLOYEE_FILES",
          message: "Employee files are required",
          details: {
            missingFileTypes: [parsed.data.fileType]
          }
        }
      });
      return;
    }

    const employeeService = options.employeeService ?? getEmployeeService();
    const admin = getAuthenticatedAdmin(response);
    const uploadedFile = mapUploadedFile(parsed.data.fileType, request.file);

    if (!uploadedFile) {
      response.status(400).json({
        error: {
          code: "MISSING_EMPLOYEE_FILES",
          message: "Employee files are required",
          details: {
            missingFileTypes: [parsed.data.fileType]
          }
        }
      });
      return;
    }

    const result = await employeeService.replaceEmployeeFile(
      parsed.data.employeeId,
      parsed.data.fileType,
      uploadedFile,
      admin.id
    );

    if ("error" in result) {
      response.status(404).json(result);
      return;
    }

    response.status(200).json(result);
  });
}
