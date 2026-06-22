import { getAppConfig } from "../../config/app-config";
import { createInMemoryAuthRepository } from "./repository";
import { createAuthService } from "./service";

const config = getAppConfig();
const repository = createInMemoryAuthRepository({
  bootstrapAdmin: config.auth.bootstrapAdmin
});

const authService = createAuthService({
  repository,
  adminSessionTtlHours: config.auth.adminSessionTtlHours,
  employeeSessionTtlHours: 12
});

export function getAuthService() {
  return authService;
}
