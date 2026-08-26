import type { FaceComparisonResult } from './attendance-service.js';

type AiFaceGatewayOptions = {
  baseUrl: string;
  fetcher?: typeof fetch;
};

type EnrollResponse = {
  success: boolean;
  embedding?: number[] | null;
};

type VerifyResponse = {
  success: boolean;
  decision?: string;
  reason?: string | null;
};

const serviceUrl = (baseUrl: string, path: string) => `${baseUrl.replace(/\/$/, '')}${path}`;

const postForm = async <T>(fetcher: typeof fetch, url: string, body: FormData): Promise<T | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetcher(url, { method: 'POST', body, signal: controller.signal });
    if (!response.ok) {
      console.warn(`AI face service rejected ${url} with HTTP ${response.status}`);
      return null;
    }
    return await response.json() as T;
  } catch (error) {
    console.warn(`AI face service request failed for ${url}`, error);
    return null;
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
      return result?.success && result.embedding?.length === 128 ? result.embedding : null;
    },
    async verify(employeeId: number, embedding: number[], frames: Blob[]): Promise<FaceComparisonResult> {
      const body = new FormData();
      body.set('employee_id', String(employeeId));
      body.set('enrolled_embedding', JSON.stringify(embedding));
      frames.forEach((frame, index) => body.append('files', frame, `frame-${index + 1}.jpg`));
      const result = await postForm<VerifyResponse>(fetcher, serviceUrl(baseUrl, '/api/v1/verify'), body);
      if (!result) return { kind: 'failed' };
      if (result.success && result.decision === 'verified') return { kind: 'match' };
      if (result.reason === 'identity_mismatch' || result.decision === 'rejected') return { kind: 'mismatch' };
      if (result.reason === 'temporal_liveness_failed') return { kind: 'spoof' };
      if (result.reason === 'no_valid_face_found') return { kind: 'face_not_found' };
      return { kind: 'failed' };
    },
    compare: (): Promise<FaceComparisonResult> => Promise.resolve({ kind: 'failed' }),
  };
  return gateway;
};
