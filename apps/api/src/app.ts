import express from "express";
import type { createAuthService } from "./modules/auth/service";
import { registerNotFoundHandler } from "./http/not-found-handler";
import { registerHealthRoutes } from "./http/health-routes";
import { registerAppMiddleware } from "./http/middleware/index";
import { registerAppRoutes } from "./http/routes";

type CreateAppOptions = {
  authService?: ReturnType<typeof createAuthService>;
};

export function createApp(options: CreateAppOptions = {}) {
  const app = express();

  registerAppMiddleware(app);
  registerHealthRoutes(app);
  registerAppRoutes(app, {
    authService: options.authService
  });
  registerNotFoundHandler(app);

  return app;
}
