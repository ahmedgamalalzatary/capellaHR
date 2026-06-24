import type { Express, Request, Response } from "express";
import type { NetworkWhoamiResponse } from "@capella/shared";
import { requireAdminSession } from "../auth/admin-session";
import type { createAuthService } from "../auth/service";
import { getRequestIpAddress } from "../../http/request-ip";

type RegisterNetworkRoutesOptions = {
  authService?: ReturnType<typeof createAuthService>;
};

export function registerNetworkRoutes(app: Express, options: RegisterNetworkRoutesOptions = {}) {
  const adminSessionMiddleware = requireAdminSession({
    authService: options.authService
  });

  app.get("/network/whoami", adminSessionMiddleware, (request: Request, response: Response) => {
    const body: NetworkWhoamiResponse = { ip: getRequestIpAddress(request) };
    response.status(200).json(body);
  });
}
