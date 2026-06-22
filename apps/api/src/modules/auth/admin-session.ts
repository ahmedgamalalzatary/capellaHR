import type { NextFunction, Request, Response } from "express";
import { getAppConfig } from "../../config/app-config";
import { getAuthService } from "./runtime";
import type { createAuthService } from "./service";

type AdminActor = {
  id: number;
  role: "admin";
  name: string;
  email: string;
};

type RequireAdminSessionOptions = {
  authService?: ReturnType<typeof createAuthService>;
};

export function requireAdminSession(options: RequireAdminSessionOptions = {}) {
  return async function adminSessionMiddleware(request: Request, response: Response, next: NextFunction) {
    const config = getAppConfig();
    const sessionToken = request.cookies?.[config.auth.cookieName];

    if (typeof sessionToken !== "string" || sessionToken.length === 0) {
      response.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required",
          details: {}
        }
      });
      return;
    }

    const authService = options.authService ?? await getAuthService();
    const actor = await authService.getAdminSessionActor(sessionToken);

    if (!actor) {
      const sessionActor = await authService.getSessionActor(sessionToken);

      if (sessionActor) {
        response.status(403).json({
          error: {
            code: "FORBIDDEN",
            message: "Admin access required",
            details: {}
          }
        });
        return;
      }

      response.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required",
          details: {}
        }
      });
      return;
    }

    response.locals.adminActor = actor;
    next();
  };
}

export function getAuthenticatedAdmin(response: Response) {
  return response.locals.adminActor as AdminActor;
}
