import type { Request } from "express";

/**
 * Best-effort client IP for a request: prefers the first hop in
 * `x-forwarded-for` (set by a fronting proxy), then Express's `request.ip`,
 * then the raw socket address.
 */
export function getRequestIpAddress(request: Request) {
  const forwardedFor = request.headers["x-forwarded-for"];

  if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
    return forwardedFor.split(",")[0]!.trim();
  }

  return request.ip || request.socket.remoteAddress || "";
}
