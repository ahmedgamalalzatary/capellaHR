import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';

describe('health HTTP API', () => {
  it('reports that the API process is alive without authentication', async () => {
    const response = await request(createApp()).get('/api/v1/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('reports readiness when the database probe succeeds', async () => {
    const response = await request(createApp({ readinessCheck: async () => undefined }))
      .get('/api/v1/health/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('reports unavailability without leaking database errors', async () => {
    const response = await request(createApp({
      readinessCheck: async () => { throw new Error('mysql://secret@database'); },
    })).get('/api/v1/health/ready');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'unavailable' });
  });
});
