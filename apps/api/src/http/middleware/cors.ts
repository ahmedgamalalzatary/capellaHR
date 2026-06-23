import type { NextFunction, Request, Response } from "express";
import { getAppConfig } from "../../config/app-config";

const ALLOWED_METHODS = "GET,POST,PATCH,PUT,DELETE,OPTIONS";
const ALLOWED_HEADERS = "Content-Type,Authorization";

function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value.trim().replace(/\/+$/, "");
  }
}

/**
 * Minimal credentialed CORS support.
 *
 * Cookies require echoing the specific request origin (a wildcard `*` is
 * rejected by browsers when credentials are sent) plus
 * `Access-Control-Allow-Credentials: true`. Origins are read from
 * `CORS_ALLOWED_ORIGINS` via the app config.
 */
export function corsMiddleware(request: Request, response: Response, next: NextFunction) {
  const { allowedOrigins } = getAppConfig().cors;
  const origin = request.headers.origin;
  const normalizedOrigin = origin ? normalizeOrigin(origin) : undefined;

  if (origin && normalizedOrigin && allowedOrigins.includes(normalizedOrigin)) {
    response.setHeader("Access-Control-Allow-Origin", normalizedOrigin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Vary", "Origin");
  }

  if (request.method === "OPTIONS") {
    response.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
    response.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
    response.setHeader("Access-Control-Max-Age", "86400");
    response.status(204).end();
    return;
  }

  next();
}
