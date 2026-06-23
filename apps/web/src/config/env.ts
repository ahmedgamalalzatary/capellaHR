/**
 * Centralized, validated access to the public runtime configuration.
 *
 * Only `NEXT_PUBLIC_*` values are available in the browser bundle, so anything
 * the client needs must be prefixed accordingly.
 */
const DEFAULT_API_URL = "http://localhost:4000";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;

if (!process.env.NEXT_PUBLIC_API_URL && process.env.NODE_ENV === "production") {
  // Surfaced in build/server logs, but never breaks the build.
  console.warn(
    `NEXT_PUBLIC_API_URL is not set; falling back to ${DEFAULT_API_URL}. ` +
      "Set it in apps/web/.env.local for non-default backends."
  );
}

export const env = {
  apiUrl
} as const;
