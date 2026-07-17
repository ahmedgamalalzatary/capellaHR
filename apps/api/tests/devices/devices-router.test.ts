import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createDevicesRouter, type DeviceService } from '../../src/modules/devices/index.js';

const service = (): DeviceService => ({
  createPairing: vi.fn(async () => ({ id: 1, pairingToken: 'x'.repeat(32) })), completePairing: vi.fn(async () => ({ id: 2 } as never)),
  cancelPairing: vi.fn(), revoke: vi.fn(), verify: vi.fn(), list: vi.fn(async () => ({ items: [], total: 0 })), get: vi.fn(), history: vi.fn(async () => []),
});
const app = (actor: 'admin' | 'employee' | null = 'admin') => { const result = express(); result.use(express.json()); result.use('/api/v1/devices', createDevicesRouter(service(), { authenticate: async () => actor ? { id: 's', tokenHash: 'h', actorType: actor, employeeId: actor === 'employee' ? 1 : null, revokedAt: null } : null })); return result; };

describe('devices HTTP API', () => {
  it('fails closed instead of accepting unverified registration material', async () => {
    const response = await request(app(null)).post(`/api/v1/devices/pairings/${'x'.repeat(32)}/complete`).send({ credentialId: 'c', publicKey: 'p', installationMarker: 'm', browser: 'Chrome', platform: 'Android' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('DEVICE_PROOF_UNSUPPORTED');
  });
  it('protects device administration with admin authentication', async () => { expect((await request(app(null)).get('/api/v1/devices')).status).toBe(401); expect((await request(app('employee')).get('/api/v1/devices').set('Cookie', 'capella_session=x')).status).toBe(403); });
  it('creates, cancels, and revokes through admin endpoints', async () => {
    expect((await request(app()).post('/api/v1/devices/pairings').set('Cookie', 'capella_session=x').send({ assignmentType: 'employee', assignmentId: 1 })).status).toBe(201);
    expect((await request(app()).delete('/api/v1/devices/pairings/1').set('Cookie', 'capella_session=x')).status).toBe(204);
    expect((await request(app()).delete('/api/v1/devices/2').set('Cookie', 'capella_session=x')).status).toBe(204);
  });
});
