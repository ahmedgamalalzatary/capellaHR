import type { EmployeeListFilterInput } from "@capella/shared";
import { createEmployeeNotFoundError } from "./employee-errors";
import { toEmployeeResponse } from "./employee-mappers";
import type { EmployeeRepository } from "./service";

export function createEmployeeReadService(repository: EmployeeRepository) {
  return {
    async listEmployees(filters: EmployeeListFilterInput) {
      const employees = await repository.listEmployees(filters);

      return employees.map(toEmployeeResponse);
    },

    async getEmployeeById(employeeId: number) {
      const employee = await repository.findEmployeeById(employeeId);

      if (!employee) {
        return createEmployeeNotFoundError();
      }

      return toEmployeeResponse(employee);
    }
  };
}
