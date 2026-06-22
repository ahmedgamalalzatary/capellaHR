import { describe, expect, it } from "vitest";
import * as schemas from "../../../src/schemas/index";

describe("audit log schemas", () => {
  it("exports audit log filter schema", () => {
    expect(schemas.auditLogListFilterSchema).toBeDefined();
  });

  it("accepts audit log list filters", () => {
    const result = schemas.auditLogListFilterSchema.parse({
      entityType: "attendance",
      actionType: "create",
      search: "Ahmed",
      dateFrom: "2026-06-01",
      dateTo: "2026-06-30"
    });

    expect(result.entityType).toBe("attendance");
    expect(result.actionType).toBe("create");
  });
});
