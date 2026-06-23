import { describe, expect, it } from "vitest";

import {
  adminSignInFormSchema,
  employeeSignInFormSchema
} from "@/features/auth/auth.schemas";

describe("employeeSignInFormSchema", () => {
  it("accepts a valid Egyptian phone and password", () => {
    const result = employeeSignInFormSchema.safeParse({
      phone: "01012345678",
      password: "secret12"
    });

    expect(result.success).toBe(true);
  });

  it("normalizes a +20 prefixed phone to the local 0-prefixed form", () => {
    const result = employeeSignInFormSchema.safeParse({
      phone: "+201012345678",
      password: "secret12"
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phone).toBe("01012345678");
    }
  });

  it("rejects a password shorter than 8 characters", () => {
    const result = employeeSignInFormSchema.safeParse({
      phone: "01012345678",
      password: "short"
    });

    expect(result.success).toBe(false);
  });

  it("rejects an invalid Egyptian phone number", () => {
    const result = employeeSignInFormSchema.safeParse({
      phone: "12345",
      password: "secret12"
    });

    expect(result.success).toBe(false);
  });
});

describe("adminSignInFormSchema", () => {
  it("accepts a valid email and password", () => {
    const result = adminSignInFormSchema.safeParse({
      email: "admin@capella.eg",
      password: "secret12"
    });

    expect(result.success).toBe(true);
  });

  it("trims and lowercases the email", () => {
    const result = adminSignInFormSchema.safeParse({
      email: "  ADMIN@Capella.EG  ",
      password: "secret12"
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("admin@capella.eg");
    }
  });

  it("rejects an invalid email", () => {
    const result = adminSignInFormSchema.safeParse({
      email: "not-an-email",
      password: "secret12"
    });

    expect(result.success).toBe(false);
  });
});
