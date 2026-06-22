import type { Express, Request, Response } from "express";
import { employeeCreateSchema, employeeListFilterSchema, employeeUpdateSchema } from "@capella/shared";
import { z } from "zod";
import { createDrizzleEmployeeRepository } from "./repository";
import { createEmployeeService, type createEmployeeService as createEmployeeServiceFactory } from "./service";
import { createDatabaseClient } from "../../db";
import { getAppConfig } from "../../config/app-config";

type RegisterEmployeesRoutesOptions = {
  employeeService?: ReturnType<typeof createEmployeeServiceFactory>;
};

export function registerEmployeesRoutes(app: Express, options: RegisterEmployeesRoutesOptions = {}) {
  const employeeIdParamsSchema = z.object({
    employeeId: z.coerce.number().int().positive()
  });

  app.post("/employees", async (request: Request, response: Response) => {
    const parsed = employeeCreateSchema.safeParse(request.body);

    if (!parsed.success) {
      sendValidationError(response, parsed.error.flatten());
      return;
    }

    const employeeService = options.employeeService ?? getEmployeeService();
    const result = await employeeService.createEmployee(parsed.data, 1);

    if ("error" in result) {
      response.status(result.error.code === "BRANCH_NOT_ASSIGNABLE" ? 409 : 409).json(result);
      return;
    }

    response.status(201).json({
      employee: result
    });
  });

  app.get("/employees", async (request: Request, response: Response) => {
    const parsed = employeeListFilterSchema.safeParse(request.query);

    if (!parsed.success) {
      sendValidationError(response, parsed.error.flatten());
      return;
    }

    const employeeService = options.employeeService ?? getEmployeeService();
    const employees = await employeeService.listEmployees(parsed.data);

    response.status(200).json({ employees });
  });

  app.get("/employees/:employeeId", async (request: Request, response: Response) => {
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

  app.patch("/employees/:employeeId", async (request: Request, response: Response) => {
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
    const result = await employeeService.updateEmployee(params.data.employeeId, body.data, 1);

    if ("error" in result) {
      response.status(result.error.code === "EMPLOYEE_NOT_FOUND" ? 404 : 409).json(result);
      return;
    }

    response.status(200).json({
      employee: result
    });
  });

  app.delete("/employees/:employeeId", async (request: Request, response: Response) => {
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
    repository
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
