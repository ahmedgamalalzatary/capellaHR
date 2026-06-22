import type { Express, Request, Response } from "express";
import { employeeCreateSchema } from "@capella/shared";
import { createDrizzleEmployeeRepository } from "./repository";
import { createEmployeeService, type createEmployeeService as createEmployeeServiceFactory } from "./service";
import { createDatabaseClient } from "../../db";
import { getAppConfig } from "../../config/app-config";

type RegisterEmployeesRoutesOptions = {
  employeeService?: ReturnType<typeof createEmployeeServiceFactory>;
};

export function registerEmployeesRoutes(app: Express, options: RegisterEmployeesRoutesOptions = {}) {
  app.post("/employees", async (request: Request, response: Response) => {
    const parsed = employeeCreateSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request payload",
          details: parsed.error.flatten()
        }
      });
      return;
    }

    const employeeService = options.employeeService ?? getEmployeeService();
    const result = await employeeService.createEmployee(parsed.data, 1);

    if ("error" in result) {
      response.status(409).json(result);
      return;
    }

    response.status(201).json({
      employee: result
    });
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
