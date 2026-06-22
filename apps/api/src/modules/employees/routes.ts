import type { Express, Request, Response } from "express";
import { employeeCreateSchema, employeeListFilterSchema, employeeUpdateSchema } from "@capella/shared";
import multer from "multer";
import { z } from "zod";
import { getAuthenticatedAdmin, requireAdminSession } from "../auth/admin-session";
import type { createAuthService } from "../auth/service";
import { createLocalEmployeeFileStorage, type EmployeeFileInput, type EmployeeFileType } from "./file-storage";
import { createDrizzleEmployeeRepository } from "./repository";
import { createEmployeeService, type createEmployeeService as createEmployeeServiceFactory } from "./service";
import { createDatabaseClient } from "../../db";
import { getAppConfig } from "../../config/app-config";

type RegisterEmployeesRoutesOptions = {
  employeeService?: ReturnType<typeof createEmployeeServiceFactory>;
  authService?: ReturnType<typeof createAuthService>;
};

export function registerEmployeesRoutes(app: Express, options: RegisterEmployeesRoutesOptions = {}) {
  const config = getAppConfig();
  const adminSessionMiddleware = requireAdminSession({
    authService: options.authService
  });
  const employeeIdParamsSchema = z.object({
    employeeId: z.coerce.number().int().positive()
  });
  const employeeFileTypeParamsSchema = z.object({
    employeeId: z.coerce.number().int().positive(),
    fileType: z.enum(["personal_photo", "id_front", "id_back"])
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: Math.min(config.uploads.maxBytes, 10 * 1024 * 1024)
    },
    fileFilter(_request, file, callback) {
      if (file.mimetype === "image/jpeg" || file.mimetype === "image/png") {
        callback(null, true);
        return;
      }

      callback(new Error("INVALID_EMPLOYEE_FILE_TYPE"));
    }
  });

  app.post("/employees", adminSessionMiddleware, upload.fields([
    { name: "personalPhoto", maxCount: 1 },
    { name: "idFront", maxCount: 1 },
    { name: "idBack", maxCount: 1 }
  ]), async (request: Request, response: Response) => {
    const parsed = employeeCreateSchema.safeParse(request.body);

    if (!parsed.success) {
      sendValidationError(response, parsed.error.flatten());
      return;
    }

    const employeeService = options.employeeService ?? getEmployeeService();
    const admin = getAuthenticatedAdmin(response);
    const result = await employeeService.createEmployee(parsed.data, getCreateEmployeeFiles(request), admin.id);

    if ("error" in result) {
      response.status(result.error.code === "MISSING_EMPLOYEE_FILES" ? 400 : 409).json(result);
      return;
    }

    response.status(201).json({
      employee: result
    });
  });

  app.get("/employees", adminSessionMiddleware, async (request: Request, response: Response) => {
    const parsed = employeeListFilterSchema.safeParse(request.query);

    if (!parsed.success) {
      sendValidationError(response, parsed.error.flatten());
      return;
    }

    const employeeService = options.employeeService ?? getEmployeeService();
    const employees = await employeeService.listEmployees(parsed.data);

    response.status(200).json({ employees });
  });

  app.get("/employees/:employeeId", adminSessionMiddleware, async (request: Request, response: Response) => {
    const parsed = employeeIdParamsSchema.safeParse(request.params);

    if (!parsed.success) {
      sendValidationError(response, parsed.error.flatten());
      return;
    }

    const employeeService = options.employeeService ?? getEmployeeService();
    const result = await employeeService.getEmployeeById(parsed.data.employeeId);

    if ("error" in result) {
      response.status(404).json(result);
      return;
    }

    response.status(200).json({
      employee: result
    });
  });

  app.patch("/employees/:employeeId", adminSessionMiddleware, async (request: Request, response: Response) => {
    const params = employeeIdParamsSchema.safeParse(request.params);
    const body = employeeUpdateSchema.safeParse(request.body);

    if (!params.success) {
      sendValidationError(response, params.error.flatten());
      return;
    }

    if (!body.success) {
      sendValidationError(response, body.error.flatten());
      return;
    }

    const employeeService = options.employeeService ?? getEmployeeService();
    const admin = getAuthenticatedAdmin(response);
    const result = await employeeService.updateEmployee(params.data.employeeId, body.data, admin.id);

    if ("error" in result) {
      response.status(result.error.code === "EMPLOYEE_NOT_FOUND" ? 404 : 409).json(result);
      return;
    }

    response.status(200).json({
      employee: result
    });
  });

  app.delete("/employees/:employeeId", adminSessionMiddleware, async (request: Request, response: Response) => {
    const parsed = employeeIdParamsSchema.safeParse(request.params);

    if (!parsed.success) {
      sendValidationError(response, parsed.error.flatten());
      return;
    }

    const employeeService = options.employeeService ?? getEmployeeService();
    const result = await employeeService.deleteEmployee(parsed.data.employeeId);

    if ("error" in result) {
      response.status(404).json(result);
      return;
    }

    response.status(204).send();
  });

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

  app.put("/employees/:employeeId/files/:fileType", adminSessionMiddleware, upload.single("file"), async (request: Request, response: Response) => {
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

let employeeService: ReturnType<typeof createEmployeeService> | null = null;

function getEmployeeService() {
  if (employeeService) {
    return employeeService;
  }

  const config = getAppConfig();
  const databaseClient = createDatabaseClient({
    databaseUrl: config.databaseUrl
  });
  const repository = createDrizzleEmployeeRepository({
    db: databaseClient.db
  });

  employeeService = createEmployeeService({
    repository,
    fileStorage: createLocalEmployeeFileStorage()
  });

  return employeeService;
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

function getCreateEmployeeFiles(request: Request): EmployeeFileInput[] {
  const files = request.files as Record<string, Express.Multer.File[]> | undefined;

  return [
    mapUploadedFile("personal_photo", files?.personalPhoto?.[0]),
    mapUploadedFile("id_front", files?.idFront?.[0]),
    mapUploadedFile("id_back", files?.idBack?.[0])
  ].filter((file): file is EmployeeFileInput => file !== null);
}

function mapUploadedFile(fileType: EmployeeFileType, file: Express.Multer.File | undefined): EmployeeFileInput | null {
  if (!file) {
    return null;
  }

  return {
    fileType,
    originalName: file.originalname,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    buffer: file.buffer
  };
}
