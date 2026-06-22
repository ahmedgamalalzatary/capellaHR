import type { Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import type { createAuthService } from "../auth/service";
import { createLocalEmployeeFileStorage, type EmployeeFileInput, type EmployeeFileType } from "./file-storage";
import { createDrizzleEmployeeRepository } from "./repository";
import { createEmployeeService, type createEmployeeService as createEmployeeServiceFactory } from "./service";
import { createDatabaseClient } from "../../db";
import { getAppConfig } from "../../config/app-config";

export type RegisterEmployeesRoutesOptions = {
  employeeService?: ReturnType<typeof createEmployeeServiceFactory>;
  authService?: ReturnType<typeof createAuthService>;
};

export const employeeIdParamsSchema = z.object({
  employeeId: z.coerce.number().int().positive()
});

export const employeeFileTypeParamsSchema = z.object({
  employeeId: z.coerce.number().int().positive(),
  fileType: z.enum(["personal_photo", "id_front", "id_back"])
});

export function createEmployeeUpload() {
  const config = getAppConfig();

  return multer({
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
}

let employeeService: ReturnType<typeof createEmployeeService> | null = null;

export function getEmployeeService() {
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

export function sendValidationError(response: Response, details: Record<string, unknown>) {
  response.status(400).json({
    error: {
      code: "VALIDATION_ERROR",
      message: "Invalid request payload",
      details
    }
  });
}

export function getCreateEmployeeFiles(request: Request): EmployeeFileInput[] {
  const files = request.files as Record<string, Express.Multer.File[]> | undefined;

  return [
    mapUploadedFile("personal_photo", files?.personalPhoto?.[0]),
    mapUploadedFile("id_front", files?.idFront?.[0]),
    mapUploadedFile("id_back", files?.idBack?.[0])
  ].filter((file): file is EmployeeFileInput => file !== null);
}

export function mapUploadedFile(fileType: EmployeeFileType, file: Express.Multer.File | undefined): EmployeeFileInput | null {
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
