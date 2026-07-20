import { afterEach, describe, expect, it, vi } from 'vitest';

import { listAuditEvents } from '../src/features/audit/api/audit-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('audit API', () => {
  it('serializes only supplied filters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [],
      meta: { page: 2, pageSize: 20, total: 0, totalPages: 0 },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await listAuditEvents({
      search: 'employee 17',
      actorType: 'admin',
      module: 'employees',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-20',
      page: 2,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/api/v1/audit?search=employee+17&actorType=admin&module=employees&dateFrom=2026-07-01&dateTo=2026-07-20&page=2',
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});
