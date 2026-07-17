/**
 * REST client for the Capella API.
 *
 * All requests carry the session cookie. Errors follow the locked REST
 * error contract: stable code, Arabic user-facing message, optional field
 * errors, and a request/correlation ID.
 */

/** Full API base including the version prefix, from the root .env */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export interface ApiFieldError {
  field: string;
  message: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  fieldErrors?: ApiFieldError[];
  requestId?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: ApiFieldError[];
  readonly requestId: string | undefined;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.fieldErrors = body.fieldErrors ?? [];
    this.requestId = body.requestId;
  }
}

const GENERIC_ERROR: ApiErrorBody = {
  code: 'UNEXPECTED_ERROR',
  message: 'حدث خطأ غير متوقع. حاول مرة أخرى.',
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      credentials: 'include',
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
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
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // Non-JSON error response; keep the generic Arabic message.
    }
    throw new ApiError(response.status, body);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
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
};
