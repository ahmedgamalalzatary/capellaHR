import type { Express, Request, RequestHandler, Response } from "express";
import { getAuthenticatedEmployee } from "../attendance/attendance-route-helpers";
import {
  type RegisterEmployeesRoutesOptions,
  getEmployeeService
} from "./employee-route-helpers";

export function registerEmployeeSelfRoutes(
  app: Express,
  options: RegisterEmployeesRoutesOptions,
  employeeSessionMiddleware: RequestHandler
) {
  app.get("/employees/me", employeeSessionMiddleware, async (_request: Request, response: Response) => {
    const employeeService = options.employeeService ?? getEmployeeService();
    const employeeActor = getAuthenticatedEmployee(response);
    const result = await employeeService.getEmployeeById(employeeActor.id);

    if ("error" in result) {
      response.status(404).json(result);
      return;
    }

    response.status(200).json({
      employee: result
    });
  });
}
