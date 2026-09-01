import type { FaceComparisonResult } from './attendance-service.js';

type AiFaceGatewayOptions = {
  baseUrl: string;
  fetcher?: typeof fetch;
};

type EnrollResponse = {
  success: boolean;
  embedding?: number[] | null;
  reason?: string | null;
};

export type FaceEnrollmentResult =
  | { kind: 'enrolled'; embedding: number[] }
  | { kind: 'rejected'; reason: string }
  | { kind: 'timeout' }
  | { kind: 'unavailable' };

type VerifyResponse = {
  success: boolean;
  decision?: string;
  reason?: string | null;
};

const serviceUrl = (baseUrl: string, path: string) => `${baseUrl.replace(/\/$/, '')}${path}`;

type PostFormResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'http_error'; status: number; detail: string | null }
  | { kind: 'timeout' }
  | { kind: 'unavailable' };

const postForm = async <T>(fetcher: typeof fetch, url: string, body: FormData): Promise<PostFormResult<T>> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetcher(url, { method: 'POST', body, signal: controller.signal });
    if (!response.ok) {
      console.warn(`AI face service rejected ${url} with HTTP ${response.status}`);
      const payload = await response.json().catch(() => null) as { detail?: unknown } | null;
      return {
        kind: 'http_error',
        status: response.status,
        detail: typeof payload?.detail === 'string' ? payload.detail : null,
      };
    }
    return { kind: 'ok', data: await response.json() as T };
  } catch (error) {
    console.warn(`AI face service request failed for ${url}`, error);
    return controller.signal.aborted ? { kind: 'timeout' } : { kind: 'unavailable' };
  } finally {
    clearTimeout(timeout);
  }
};

export const createAiFaceGateway = ({ baseUrl, fetcher = fetch }: AiFaceGatewayOptions) => {
  const gateway = {
    async enroll(employeeId: number, photo: Blob) {
      const body = new FormData();
      body.set('employee_id', String(employeeId));
      body.set('file', photo, 'personal.jpg');
      const result = await postForm<EnrollResponse>(fetcher, serviceUrl(baseUrl, '/api/v1/enroll'), body);
      if (result.kind === 'timeout' || result.kind === 'unavailable') return result;
      if (result.kind === 'http_error') {
        return result.status === 400
          ? { kind: 'rejected' as const, reason: result.detail === 'Invalid image file' ? 'invalid_image' : 'invalid_request' }
          : { kind: 'unavailable' as const };
      }
      if (result.data.success
        && Array.isArray(result.data.embedding)
        && result.data.embedding.length === 128
        && result.data.embedding.every(Number.isFinite)) {
        return { kind: 'enrolled' as const, embedding: result.data.embedding };
      }
      return { kind: 'rejected' as const, reason: result.data.reason ?? 'invalid_response' };
    },
    async verify(employeeId: number, embedding: number[], frames: Buffer[]): Promise<FaceComparisonResult> {
      const body = new FormData();
      body.set('employee_id', String(employeeId));
      body.set('enrolled_embedding', JSON.stringify(embedding));
      frames.forEach((frame, index) => body.append(
        'files',
        new Blob([new Uint8Array(frame)], { type: 'image/jpeg' }),
        `frame-${index + 1}.jpg`,
      ));
      const result = await postForm<VerifyResponse>(fetcher, serviceUrl(baseUrl, '/api/v1/verify'), body);
      if (result.kind !== 'ok') return { kind: 'failed' };
      if (result.data.success && result.data.decision === 'verified') return { kind: 'match' };
      if (result.data.reason === 'identity_mismatch' || result.data.decision === 'rejected') return { kind: 'mismatch' };
      if (result.data.reason === 'temporal_liveness_failed') return { kind: 'spoof' };
      if (result.data.reason === 'no_valid_face_found') return { kind: 'face_not_found' };
      return { kind: 'failed' };
    },
    compare: (): Promise<FaceComparisonResult> => Promise.resolve({ kind: 'failed' }),
  };
  return gateway;
};
