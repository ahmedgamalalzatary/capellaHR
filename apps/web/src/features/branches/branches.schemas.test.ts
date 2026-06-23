import { describe, expect, it } from "vitest";

import { branchFormSchema } from "@/features/branches/branches.schemas";

const validInput = {
  name: "فرع المعادي",
  address: "شارع 9، المعادي، القاهرة",
  gpsLatitude: 29.9602,
  gpsLongitude: 31.2569,
  gpsRadiusMeters: 100,
  allowedIpCidr: "196.221.0.0/16"
};

describe("branchFormSchema", () => {
  it("accepts a fully valid branch", () => {
    const result = branchFormSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("rejects an empty name", () => {
    const result = branchFormSchema.safeParse({ ...validInput, name: "  " });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("اسم الفرع مطلوب");
    }
  });

  it("rejects an empty address", () => {
    const result = branchFormSchema.safeParse({ ...validInput, address: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a latitude outside [-90, 90]", () => {
    const result = branchFormSchema.safeParse({ ...validInput, gpsLatitude: 120 });
    expect(result.success).toBe(false);
  });

  it("rejects a longitude outside [-180, 180]", () => {
    const result = branchFormSchema.safeParse({ ...validInput, gpsLongitude: 200 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-positive radius", () => {
    const result = branchFormSchema.safeParse({ ...validInput, gpsRadiusMeters: 0 });
    expect(result.success).toBe(false);
  });

  it("coerces numeric strings from form inputs", () => {
    const result = branchFormSchema.safeParse({
      ...validInput,
      gpsLatitude: "29.9602",
      gpsLongitude: "31.2569",
      gpsRadiusMeters: "100"
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.gpsRadiusMeters).toBe(100);
      expect(result.data.gpsLatitude).toBe(29.9602);
    }
  });

  it("rejects an empty allowed IP CIDR", () => {
    const result = branchFormSchema.safeParse({ ...validInput, allowedIpCidr: "" });
    expect(result.success).toBe(false);
  });
});
