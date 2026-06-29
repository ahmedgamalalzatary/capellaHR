import { describe, expect, it } from "vitest";

import {
  MAX_IMAGE_BYTES,
  employeeCreateFormSchema,
  employeeEditFormSchema
} from "@/features/employees/employees.schemas";

/** Build a fake image File of a given type/size without allocating real bytes. */
function makeImage(type = "image/png", size = 1024): File {
  const file = new File(["x"], "photo.png", { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

const validCreate = {
  fullName: "أحمد جمال",
  password: "secret12",
  primaryPhone: "01012345678",
  whatsappPhone: "01112345678",
  email: "ahmed@capella.eg",
  branchId: 1,
  age: 30,
  address: "المعادي، القاهرة",
  currentMonthlySalary: 8000,
  personalPhoto: makeImage(),
  idFront: makeImage(),
  idBack: makeImage()
};

describe("employeeCreateFormSchema", () => {
  it("accepts a fully valid create input", () => {
    expect(employeeCreateFormSchema.safeParse(validCreate).success).toBe(true);
  });

  it("rejects an empty full name with an Arabic message", () => {
    const result = employeeCreateFormSchema.safeParse({ ...validCreate, fullName: "  " });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("الاسم الكامل مطلوب");
    }
  });

  it("rejects a password shorter than 8 characters", () => {
    expect(employeeCreateFormSchema.safeParse({ ...validCreate, password: "short" }).success).toBe(
      false
    );
  });

  it("normalizes a +20 phone and accepts it", () => {
    const result = employeeCreateFormSchema.safeParse({
      ...validCreate,
      primaryPhone: "+201012345678"
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.primaryPhone).toBe("01012345678");
    }
  });

  it("rejects an invalid Egyptian phone", () => {
    expect(employeeCreateFormSchema.safeParse({ ...validCreate, primaryPhone: "0991234" }).success).toBe(
      false
    );
  });

  it("treats an empty email as allowed (optional)", () => {
    expect(employeeCreateFormSchema.safeParse({ ...validCreate, email: "" }).success).toBe(true);
  });

  it("normalizes a padded email before validating it", () => {
    const result = employeeCreateFormSchema.safeParse({
      ...validCreate,
      email: "  USER@Example.COM  "
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("user@example.com");
    }
  });

  it("treats a whitespace-only email as empty", () => {
    const result = employeeCreateFormSchema.safeParse({ ...validCreate, email: "   " });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("");
    }
  });

  it("rejects a malformed email", () => {
    expect(employeeCreateFormSchema.safeParse({ ...validCreate, email: "not-an-email" }).success).toBe(
      false
    );
  });

  it("rejects a non-positive branch id", () => {
    expect(employeeCreateFormSchema.safeParse({ ...validCreate, branchId: 0 }).success).toBe(false);
  });

  it("coerces numeric strings from inputs for age and salary", () => {
    const result = employeeCreateFormSchema.safeParse({
      ...validCreate,
      age: "30",
      currentMonthlySalary: "8000"
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.age).toBe(30);
      expect(result.data.currentMonthlySalary).toBe(8000);
    }
  });

  it("rejects a negative salary", () => {
    expect(
      employeeCreateFormSchema.safeParse({ ...validCreate, currentMonthlySalary: -1 }).success
    ).toBe(false);
  });

  it("rejects a non-image file type", () => {
    const result = employeeCreateFormSchema.safeParse({
      ...validCreate,
      idFront: makeImage("application/pdf")
    });
    expect(result.success).toBe(false);
  });

  it("rejects an image over the size limit", () => {
    const result = employeeCreateFormSchema.safeParse({
      ...validCreate,
      idBack: makeImage("image/png", MAX_IMAGE_BYTES + 1)
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing required image", () => {
    const { personalPhoto, ...withoutPhoto } = validCreate;
    void personalPhoto;
    expect(employeeCreateFormSchema.safeParse(withoutPhoto).success).toBe(false);
  });
});

describe("employeeEditFormSchema", () => {
  const validEdit = {
    fullName: "أحمد جمال",
    password: "",
    primaryPhone: "01012345678",
    whatsappPhone: "01112345678",
    email: "ahmed@capella.eg",
    branchId: 1,
    age: 30,
    address: "المعادي، القاهرة",
    currentMonthlySalary: 8000
  };

  it("accepts an empty password (unchanged) without file fields", () => {
    expect(employeeEditFormSchema.safeParse(validEdit).success).toBe(true);
  });

  it("accepts a new password of at least 8 characters", () => {
    expect(employeeEditFormSchema.safeParse({ ...validEdit, password: "newsecret" }).success).toBe(
      true
    );
  });

  it("rejects a too-short non-empty password", () => {
    expect(employeeEditFormSchema.safeParse({ ...validEdit, password: "abc" }).success).toBe(false);
  });
});
