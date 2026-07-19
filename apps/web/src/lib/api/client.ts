/**
 * REST client for the Capella API.
 *
 * All requests carry the session cookie. Success bodies use the envelope
 * `{ data: T }`. Errors follow the locked REST contract:
 * `{ error: { code, message, fieldErrors?, requestId } }` where fieldErrors
 * is a zod-flatten map of field name to Arabic messages.
 */

/** Full API base including the version prefix, from the root .env */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export type ApiFieldErrors = Record<string, string[] | undefined>;

export interface ApiErrorBody {
  code: string;
  message: string;
  fieldErrors?: ApiFieldErrors;
  requestId?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: ApiFieldErrors;
  readonly requestId: string | undefined;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.fieldErrors = body.fieldErrors ?? {};
    this.requestId = body.requestId;
  }
}

/** Safe fallback when an upstream error body is missing or is not valid JSON. */
const GENERIC_ERROR: ApiErrorBody = {
  code: 'UNEXPECTED_ERROR',
  message: 'حدث خطأ غير متوقع. حاول مرة أخرى.',
};

async function requestRaw(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      credentials: 'include',
      ...init,
      headers: {
        // FormData bodies must let the browser set the multipart boundary.
        ...(init?.body && !(init.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(0, {
      code: 'NETWORK_ERROR',
      message: 'تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.',
    });
  }

  if (!response.ok) {
    let body: ApiErrorBody = GENERIC_ERROR;
    try {
      const parsed = (await response.json()) as { error?: ApiErrorBody };
      if (parsed.error?.code && parsed.error.message) {
        body = parsed.error;
      }
    } catch {
      // Non-JSON error response; keep the generic Arabic message.
    }
    throw new ApiError(response.status, body);
  }

  return response;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await requestRaw(path, init);

  if (response.status === 204) {
    return undefined as T;
  }

  const envelope = (await response.json()) as { data: T };
  return envelope.data;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** List envelopes carry `meta` beside `data`; keep both. */
async function requestPage<T>(path: string): Promise<{ items: T[]; meta: PageMeta }> {
  const response = await requestRaw(path);
  const parsed = (await response.json()) as { data: T[]; meta: PageMeta };
  return { items: parsed.data, meta: parsed.meta };
}

/** Single-object envelopes that still carry pagination `meta` (report snapshots). */
async function requestWithMeta<T>(path: string): Promise<{ data: T; meta: PageMeta }> {
  const response = await requestRaw(path);
  return (await response.json()) as { data: T; meta: PageMeta };
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  getPage: <T>(path: string) => requestPage<T>(path),
  getWithMeta: <T>(path: string) => requestWithMeta<T>(path),
  /** Binary downloads (report PDFs) — errors still follow the JSON contract. */
  getBlob: async (path: string) => (await requestRaw(path)).blob(),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? null : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body === undefined ? null : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body === undefined ? null : JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  /** multipart uploads (employee images) — browser sets the boundary header */
  postForm: <T>(path: string, form: FormData) =>
    request<T>(path, { method: 'POST', body: form }),
  patchForm: <T>(path: string, form: FormData) =>
    request<T>(path, { method: 'PATCH', body: form }),
};
