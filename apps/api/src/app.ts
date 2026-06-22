import express from "express";
import { registerHealthRoutes } from "./http/health-routes.js";
import { registerAppMiddleware } from "./http/middleware/index.js";
import { registerAppRoutes } from "./http/routes.js";

export function createApp() {
  const app = express();

  registerAppMiddleware(app);
  registerHealthRoutes(app);
  registerAppRoutes(app);

  return app;
}
