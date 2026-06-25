import { describe, expect, it } from "vitest";

import { employeeKeys } from "@/features/employees/employees.keys";

describe("employeeKeys", () => {
  it("namespaces every key under 'employees'", () => {
    expect(employeeKeys.all).toEqual(["employees"]);
    expect(employeeKeys.lists()).toEqual(["employees", "list"]);
    expect(employeeKeys.details()).toEqual(["employees", "detail"]);
  });

  it("includes the filters object in a list key so distinct filters cache apart", () => {
    expect(employeeKeys.list({ page: 2, search: "ahmed" })).toEqual([
      "employees",
      "list",
      { page: 2, search: "ahmed" }
    ]);
  });

  it("defaults the list key filters to an empty object when none are given", () => {
    expect(employeeKeys.list()).toEqual(["employees", "list", {}]);
  });

  it("derives detail, files, and assignments keys from the employee id", () => {
    expect(employeeKeys.detail(7)).toEqual(["employees", "detail", 7]);
    expect(employeeKeys.files(7)).toEqual(["employees", "detail", 7, "files"]);
    expect(employeeKeys.assignments(7)).toEqual(["employees", "detail", 7, "assignments"]);
  });
});
