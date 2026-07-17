import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createBranchesRouter, type BranchService } from '../../src/modules/branches/index.js';

const record = {
  id: 1, name: 'Cairo', nameNormalized: 'cairo', location: 'Nasr City', latitude: 30,
  longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50,
  hasEverBeenReferenced: false, createdAt: new Date(), updatedAt: new Date(),
};

const makeService = (): BranchService => ({
  create: vi.fn(async () => record),
  get: vi.fn(async () => record),
  list: vi.fn(async () => ({ items: [record], total: 1 })),
  update: vi.fn(async () => record),
  remove: vi.fn(async () => undefined),
  markReferenced: vi.fn(async () => true),
});

const makeApp = (actor: 'admin' | 'employee' | null = 'admin') => {
  const app = express();
  app.use(express.json());
  const authService = {
    async authenticate() {
      if (!actor) return null;
      return { id: 's', tokenHash: 'h', actorType: actor, employeeId: actor === 'employee' ? 4 : null, revokedAt: null };
    },
  };
  app.use('/api/v1/branches', createBranchesRouter(makeService(), authService));
  return app;
};

describe('branches HTTP API', () => {
  it('requires an authenticated admin', async () => {
    expect((await request(makeApp(null)).get('/api/v1/branches')).status).toBe(401);
    expect((await request(makeApp('employee')).get('/api/v1/branches').set('Cookie', 'capella_session=x')).status).toBe(403);
  });

  it('creates a branch from a complete GPS reading', async () => {
    const response = await request(makeApp()).post('/api/v1/branches').set('Cookie', 'capella_session=x').send({
      name: 'Cairo', location: 'Nasr City', latitude: 30, longitude: 31,
      gpsAccuracyMeters: 5, attendanceRadiusMeters: 50,
    });
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ id: 1, name: 'Cairo' });
  });

  it('returns pagination metadata and validates partial GPS updates', async () => {
    const list = await request(makeApp()).get('/api/v1/branches?page=1&pageSize=20').set('Cookie', 'capella_session=x');
    const update = await request(makeApp()).patch('/api/v1/branches/1').set('Cookie', 'capella_session=x').send({ latitude: 30 });
    expect(list.body.meta).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
    expect(update.status).toBe(400);
    expect(update.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('deletes an eligible branch with no response body', async () => {
    expect((await request(makeApp()).delete('/api/v1/branches/1').set('Cookie', 'capella_session=x')).status).toBe(204);
  });
});
