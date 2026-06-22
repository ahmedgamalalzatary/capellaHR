import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as schemas from "./index.js";

describe("shared schemas", () => {
  it("exports domain schema modules", () => {
    expect(schemas).toMatchObject({
      signInSchema: expect.any(z.ZodType),
      employeeCreateSchema: expect.any(z.ZodType),
      branchCreateSchema: expect.any(z.ZodType),
      attendanceActionSchema: expect.any(z.ZodType),
      monthlyAttendanceSummaryFilterSchema: expect.any(z.ZodType)
    });
  });

  it("normalizes egyptian phone numbers in employee creation payloads", () => {
    const result = schemas.employeeCreateSchema.parse({
      fullName: "Employee One",
      password: "secret123",
      primaryPhone: "+201012345678",
      whatsappPhone: "201112345678",
      email: "employee@capella.eg",
      branchId: 1,
      age: 25,
      address: "Cairo",
      currentMonthlySalary: "5000.00"
    });

    expect(result.primaryPhone).toBe("01012345678");
    expect(result.whatsappPhone).toBe("01112345678");
  });

  it("rejects invalid egyptian phone numbers", () => {
    const result = schemas.employeeCreateSchema.safeParse({
      fullName: "Employee One",
      password: "secret123",
      primaryPhone: "12345",
      whatsappPhone: "01512345678",
      branchId: 1,
      age: 25,
      address: "Cairo",
      currentMonthlySalary: "5000.00"
    });

    expect(result.success).toBe(false);
  });

  it("accepts branch setup pending as a valid branch status", () => {
    const result = schemas.branchCreateSchema.parse({
      name: "Nasr City",
      address: "Cairo",
      gpsLatitude: "30.044420",
      gpsLongitude: "31.235712",
      gpsRadiusMeters: 150,
      allowedIpCidr: "192.168.1.0/24",
      setupStatus: "setup_pending"
    });

    expect(result.setupStatus).toBe("setup_pending");
  });
});
