import { env } from "@/shared/config/env";

/**
 * Error thrown for any non-2xx API response. Carries the HTTP status and the
 * parsed error payload so callers (and TanStack Query) can branch on it.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(status: number, message: string, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

type ApiErrorBody = {
  error?: { message?: string; code?: string };
  message?: string;
};

function extractMessage(status: number, body: unknown): string {
  if (body && typeof body === "object") {
    const b = body as ApiErrorBody;
    return b.error?.message ?? b.message ?? `Request failed with status ${status}`;
  }
  return `Request failed with status ${status}`;
}

export type ApiRequestOptions = Omit<RequestInit, "body"> & {
  /** JSON-serializable body. Use `formData` for file uploads instead. */
  json?: unknown;
  /** Raw body for multipart/form-data uploads (employee files, etc.). */
  formData?: FormData;
  /** Query-string params; `undefined`/`null` values are skipped. */
  query?: Record<string, string | number | boolean | undefined | null>;
};

type ApiGetBlobOptions = Pick<
  RequestInit,
  "cache" | "credentials" | "headers" | "integrity" | "keepalive" | "mode" | "redirect" | "referrer" | "referrerPolicy" | "signal" | "window"
> & {
  /** Query-string params; `undefined`/`null` values are skipped. */
  query?: ApiRequestOptions["query"];
};

function buildUrl(path: string, query?: ApiRequestOptions["query"]): string {
  const normalizedPath = path.replace(/^\//, "");
  const normalizedBase = env.apiUrl.endsWith("/") ? env.apiUrl : `${env.apiUrl}/`;
  const isRelativeBase = normalizedBase.startsWith("/");

  if (isRelativeBase && typeof window === "undefined") {
    throw new Error("Relative NEXT_PUBLIC_API_URL values require a browser origin");
  }

  const base =
    isRelativeBase && typeof window !== "undefined"
      ? new URL(normalizedBase, window.location.origin).toString()
      : normalizedBase;
  const url = new URL(normalizedPath, base);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

/**
 * Thin typed wrapper around `fetch`.
 *
 * - Sends cookies on every request (`credentials: "include"`) because the API
 *   authenticates via session cookies.
 * - Serializes `json` bodies and sets the content type; leaves `formData`
 *   untouched so the browser sets the multipart boundary.
 * - Throws `ApiError` on non-2xx so React Query treats it as a query error.
 */
export async function apiFetch<TResponse>(
  path: string,
  { json, formData, query, headers, ...init }: ApiRequestOptions = {}
): Promise<TResponse> {
  const finalHeaders = new Headers(headers);
  let body: BodyInit | undefined;

  if (formData) {
    body = formData;
  } else if (json !== undefined) {
    body = JSON.stringify(json);
    finalHeaders.set("Content-Type", "application/json");
  }

  const response = await fetch(buildUrl(path, query), {
    ...init,
    body,
    headers: finalHeaders,
    credentials: "include"
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    throw new ApiError(response.status, extractMessage(response.status, payload), payload);
  }

  return payload as TResponse;
}

/**
 * GET a binary resource (e.g. a private employee image) as a `Blob`. Sends
 * cookies like the rest of the client and throws `ApiError` on non-2xx so
 * callers can branch on auth/not-found the same way they do for JSON.
 */
export async function apiFetchBlob(
  path: string,
  options: ApiGetBlobOptions = {}
): Promise<Blob> {
  const {
    cache,
    credentials,
    headers,
    integrity,
    keepalive,
    mode,
    query,
    redirect,
    referrer,
    referrerPolicy,
    signal,
    window
  } = options;

  const response = await fetch(buildUrl(path, query), {
    cache,
    credentials: credentials ?? "include",
    headers: new Headers(headers),
    integrity,
    keepalive,
    method: "GET",
    mode,
    redirect,
    referrer,
    referrerPolicy,
    signal,
    window
  });

  if (!response.ok) {
    const isJson = response.headers.get("content-type")?.includes("application/json");
    const payload = isJson ? await response.json().catch(() => null) : null;
    throw new ApiError(response.status, extractMessage(response.status, payload), payload);
  }

  return response.blob();
}

/** Convenience helpers mirroring the HTTP verbs the API uses. */
export const api = {
  get: <T>(path: string, options?: ApiRequestOptions) =>
    apiFetch<T>(path, { ...options, method: "GET" }),
  getBlob: (path: string, options?: ApiGetBlobOptions) => apiFetchBlob(path, options),
  post: <T>(path: string, options?: ApiRequestOptions) =>
    apiFetch<T>(path, { ...options, method: "POST" }),
  patch: <T>(path: string, options?: ApiRequestOptions) =>
    apiFetch<T>(path, { ...options, method: "PATCH" }),
  put: <T>(path: string, options?: ApiRequestOptions) =>
    apiFetch<T>(path, { ...options, method: "PUT" }),
  delete: <T>(path: string, options?: ApiRequestOptions) =>
    apiFetch<T>(path, { ...options, method: "DELETE" })
};
