import { afterEach, describe, expect, it } from "vitest";
import { getAppConfig } from "../../../src/config/app-config";

const ORIGINAL_ADMIN_NAME = process.env.ADMIN_NAME;
const ORIGINAL_ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ORIGINAL_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

afterEach(() => {
  process.env.ADMIN_NAME = ORIGINAL_ADMIN_NAME;
  process.env.ADMIN_EMAIL = ORIGINAL_ADMIN_EMAIL;
  process.env.ADMIN_PASSWORD = ORIGINAL_ADMIN_PASSWORD;
});

describe("getAppConfig", () => {
  it("does not synthesize bootstrap admin credentials when env vars are missing", () => {
    delete process.env.ADMIN_NAME;
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD;

    const config = getAppConfig();

    expect(config.auth.bootstrapAdmin).toBeNull();
  });

  it("returns bootstrap admin credentials only when they are explicitly configured", () => {
    process.env.ADMIN_NAME = "Configured Admin";
    process.env.ADMIN_EMAIL = "admin.test@capella.invalid";
    process.env.ADMIN_PASSWORD = "test-admin-pass-123";

    const config = getAppConfig();

    expect(config.auth.bootstrapAdmin).toEqual({
      name: "Configured Admin",
      email: "admin.test@capella.invalid",
      password: "test-admin-pass-123"
    });
  });
});
