import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createErpBookingsRouter } from '../../src/modules/erp/bookings/booking-router.js';
import { BookingError } from '../../src/modules/erp/bookings/booking-service.js';

const actor = { type: 'cashier', accountId: 2, branchId: 1 };
const service = () => ({
  create: vi.fn().mockResolvedValue({ id: 9 }),
  get: vi.fn().mockResolvedValue({ id: 9 }),
  listDay: vi.fn().mockResolvedValue([{ id: 9 }]),
  updateStatus: vi.fn().mockResolvedValue({ id: 9, status: 'arrived' }),
  remove: vi.fn().mockResolvedValue({ id: 9 }),
  countFutureForEmployee: vi.fn(),
  hasAny: vi.fn(),
  listEmployeeOptions: vi.fn().mockResolvedValue([]),
  updatePreference: vi.fn().mockResolvedValue({ id: 9 }),
});
const app = (bookingService = service()) => {
  const result = express();
  result.use(express.json());
  result.use((_request, response, next) => { response.locals.actor = actor; next(); });
  result.use('/api/v1/erp/bookings', createErpBookingsRouter(bookingService));
  return { app: result, service: bookingService };
};

describe('ERP booking HTTP API', () => {
  it('creates and lists a diary day', async () => {
    const test = app();
    expect((await request(test.app).post('/api/v1/erp/bookings').send({
      clientId: 11,
      scheduledAt: '2026-08-25T10:30:00+03:00',
      services: [{ serviceId: 3 }],
    })).status).toBe(201);
    expect((await request(test.app).get('/api/v1/erp/bookings?date=2026-08-25')).status).toBe(200);
    expect(test.service.listDay).toHaveBeenCalledWith(
      { role: 'cashier', accountId: 2, branchId: 1 },
      { date: '2026-08-25' },
    );
  });

  it('marks arrival through the guarded status endpoint', async () => {
    const test = app();
    const response = await request(test.app)
      .patch('/api/v1/erp/bookings/9/status').send({ status: 'arrived' });
    expect(response.status).toBe(200);
    expect(test.service.updateStatus).toHaveBeenCalledWith(
      { role: 'cashier', accountId: 2, branchId: 1 }, 9, { status: 'arrived' },
    );
  });

  it('returns field errors for an invalid booking', async () => {
    const response = await request(app().app).post('/api/v1/erp/bookings').send({ services: [] });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('hard-deletes a booking without payment', async () => {
    const test = app();
    const response = await request(test.app).delete('/api/v1/erp/bookings/9');
    expect(response.status).toBe(200);
    expect(test.service.remove).toHaveBeenCalledWith(
      { role: 'cashier', accountId: 2, branchId: 1 }, 9, undefined,
    );
  });

  it('maps a missing booking to 404', async () => {
    const failing = service();
    failing.remove.mockRejectedValue(new BookingError('BOOKING_NOT_FOUND'));
    const response = await request(app(failing).app).delete('/api/v1/erp/bookings/999');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('BOOKING_NOT_FOUND');
  });

  it('maps a converted booking to 409', async () => {
    const failing = service();
    failing.remove.mockRejectedValue(new BookingError('BOOKING_ALREADY_HANDLED'));
    const response = await request(app(failing).app).delete('/api/v1/erp/bookings/9');
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('BOOKING_ALREADY_HANDLED');
  });
});
