import request from "supertest";
import type {
  EmployeeDeviceSetupCompletionInput,
  EmployeeDeviceSetupLinkCreateInput
} from "@capella/shared";
import { createApp } from "../../../../src/app";
import { createInMemoryAuthRepository } from "../../../../src/modules/auth/repository";
import { createAuthService } from "../../../../src/modules/auth/service";

export { InMemoryEmployeeDeviceRepository, assertEmployeeDeviceState } from "./employee-device-service.fixtures";

export function createAdminAuthService() {
  return createAuthService({
    repository: createInMemoryAuthRepository({
      bootstrapAdmin: {
        name: "Capella Admin",
        email: "admin@capella.eg",
        password: "admin1234"
      }
    }),
    adminSessionTtlHours: 8,
    employeeSessionTtlHours: 12
  });
}

export async function signInAdmin(app: ReturnType<typeof createApp>) {
  const response = await request(app).post("/auth/admin/sign-in").send({
    email: "admin@capella.eg",
    password: "admin1234"
  });

  return response.headers["set-cookie"];
}

export function validCreatePayload(): EmployeeDeviceSetupLinkCreateInput {
  return {
    deviceLabel: "Samsung A55"
  };
}

export function validCompletionPayload(): EmployeeDeviceSetupCompletionInput {
  return {
    browserFingerprint: "browser-fingerprint"
  };
}
