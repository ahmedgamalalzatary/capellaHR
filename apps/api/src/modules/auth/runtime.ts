import { getAppConfig } from "../../config/app-config";
import { createDatabaseClient } from "../../db";
import {
  createDrizzleAuthRepository,
  syncBootstrapAdmin
} from "./repository";
import { createAuthService } from "./service";

let authServicePromise: Promise<ReturnType<typeof createAuthService>> | null = null;

export async function getAuthService() {
  if (authServicePromise) {
    return authServicePromise;
  }

  authServicePromise = (async () => {
    const config = getAppConfig();
    const databaseClient = createDatabaseClient({
      databaseUrl: config.databaseUrl
    });
    const repository = createDrizzleAuthRepository({
      db: databaseClient.db
    });

    await syncBootstrapAdmin(repository, config.auth.bootstrapAdmin);

    return createAuthService({
      repository,
      adminSessionTtlHours: config.auth.adminSessionTtlHours,
      employeeSessionTtlHours: 12
    });
  })();

  return authServicePromise;
}
