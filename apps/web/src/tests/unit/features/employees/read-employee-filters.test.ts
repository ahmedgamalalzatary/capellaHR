import { describe, expect, it } from "vitest";

import { readEmployeeFilters } from "@/features/employees/read-employee-filters";

/** Build a URL param getter from a plain object for testing. */
function getter(params: Record<string, string>) {
  return (key: string) => params[key] ?? null;
}

describe("readEmployeeFilters", () => {
  it("defaults to page 1 with no filters when the URL is empty", () => {
    expect(readEmployeeFilters(getter({}))).toEqual({ page: 1 });
  });

  it("parses page, search, branchId, and status from the URL", () => {
    const filters = readEmployeeFilters(
      getter({ page: "3", search: "أحمد", branchId: "2", status: "active" })
    );
    expect(filters).toEqual({ page: 3, search: "أحمد", branchId: 2, status: "active" });
  });

  it("ignores an invalid page and falls back to 1", () => {
    expect(readEmployeeFilters(getter({ page: "abc" })).page).toBe(1);
  });

  it("ignores a non-numeric branchId", () => {
    expect(readEmployeeFilters(getter({ branchId: "x" })).branchId).toBeUndefined();
  });

  it("ignores an unrecognized status value", () => {
    expect(readEmployeeFilters(getter({ status: "weird" })).status).toBeUndefined();
  });

  it("treats an empty search as no search", () => {
    expect(readEmployeeFilters(getter({ search: "" })).search).toBeUndefined();
  });
});
