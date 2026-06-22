import type { Express, RequestHandler, Request, Response } from "express";
import { employeeCreateSchema, employeeListFilterSchema, employeeUpdateSchema } from "@capella/shared";
import { getAuthenticatedAdmin } from "../auth/admin-session";
import {
  type RegisterEmployeesRoutesOptions,
  employeeIdParamsSchema,
  getCreateEmployeeFiles,
  getEmployeeService,
  sendValidationError
} from "./employee-route-helpers";

export function registerEmployeeCrudRoutes(
  app: Express,
  options: RegisterEmployeesRoutesOptions,
  adminSessionMiddleware: RequestHandler,
  uploadCreateFields: RequestHandler
) {
  app.post("/employees", adminSessionMiddleware, uploadCreateFields, async (request: Request, response: Response) => {
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
    const admin = getAuthenticatedAdmin(response);
    const result = await employeeService.deleteEmployee(parsed.data.employeeId, admin.id);

    if ("error" in result) {
      response.status(404).json(result);
      return;
    }

    response.status(204).send();
  });
}
