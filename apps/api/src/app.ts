import express from "express";
import { registerNotFoundHandler } from "./http/not-found-handler";
import { registerHealthRoutes } from "./http/health-routes";
import { registerAppMiddleware } from "./http/middleware/index";
import { registerAppRoutes } from "./http/routes";

export function createApp() {
  const app = express();

  registerAppMiddleware(app);
  registerHealthRoutes(app);
  registerAppRoutes(app);
  registerNotFoundHandler(app);

  return app;
}
