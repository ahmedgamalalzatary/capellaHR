import { describe, expect, it } from "vitest";
import * as schemas from "../../../src/schemas/index";

describe("month lock schemas", () => {
  it("exports month lock schema modules", () => {
    expect(schemas.monthLockCreateSchema).toBeDefined();
    expect(schemas.monthLockListFilterSchema).toBeDefined();
  });

  it("accepts valid month lock payloads", () => {
    const result = schemas.monthLockCreateSchema.parse({
      monthKey: "2026-06",
      notes: "Month closed after attendance review"
    });

    expect(result.monthKey).toBe("2026-06");
    expect(result.notes).toBe("Month closed after attendance review");
  });
});
