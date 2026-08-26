import { describe, expect, it, vi } from 'vitest';

import { createAiFaceGateway } from '../../src/modules/attendance/ai-face-gateway.js';

describe('AI face service gateway', () => {
  it('enrolls a photo and returns the service embedding', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      employee_id: '42',
      decision: 'enrolled',
      embedding: Array.from({ length: 128 }, (_, index) => index / 128),
      embedding_dimensions: 128,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const gateway = createAiFaceGateway({ baseUrl: 'http://attendance-ai:8000', fetcher });

    const result = await gateway.enroll(42, new Blob(['photo'], { type: 'image/jpeg' }));

    expect(result).toHaveLength(128);
    expect(fetcher).toHaveBeenCalledWith('http://attendance-ai:8000/api/v1/enroll', expect.objectContaining({ method: 'POST' }));
    const request = fetcher.mock.calls[0]?.[1];
    expect(request?.body).toBeInstanceOf(FormData);
    expect((request?.body as FormData).get('employee_id')).toBe('42');
  });

  it('verifies all captured frames against the stored embedding', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      decision: 'verified',
      employee_id: '42',
      face_detected: true,
      face_count: 1,
      liveness: true,
      identity_match: true,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const gateway = createAiFaceGateway({ baseUrl: 'http://attendance-ai:8000', fetcher });
    const frames = [1, 2, 3, 4, 5].map((index) => new Blob([`frame-${index}`], { type: 'image/jpeg' }));
    const embedding = Array.from({ length: 128 }, () => 0.25);

    await expect(gateway.verify(42, embedding, frames)).resolves.toEqual({ kind: 'match' });

    const request = fetcher.mock.calls[0]?.[1];
    const body = request?.body as FormData;
    expect(body.get('employee_id')).toBe('42');
    expect(JSON.parse(body.get('enrolled_embedding') as string)).toEqual(embedding);
    expect(body.getAll('files')).toHaveLength(5);
  });
});
