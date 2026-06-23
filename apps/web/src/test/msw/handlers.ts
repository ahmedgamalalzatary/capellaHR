import { http, HttpResponse } from "msw";

import { env } from "@/shared/config/env";

/** Build an absolute URL against the configured API base for handlers. */
export const apiUrl = (path: string) => new URL(path.replace(/^\//, ""), `${env.apiUrl}/`).toString();

/**
 * Default handlers. Keep these as harmless catch-alls; individual tests should
 * override with `server.use(...)` to assert specific request/response behavior.
 */
export const handlers = [
  http.get(apiUrl("/auth/me"), () =>
    HttpResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required", details: {} } },
      { status: 401 }
    )
  )
];
