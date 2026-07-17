import { createApp } from '../../src/app.js';
import type { AuthService } from '../../src/modules/auth/auth-service.js';
import type { EmployeeService } from '../../src/modules/employees/employees-service.js';
import type { EmployeeUploadStore } from '../../src/modules/employees/employee-upload-store.js';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const auth = { authenticate: vi.fn(async () => ({ actorType: 'admin' })) } as unknown as AuthService;
const service = { list: vi.fn(async () => ({ items: [], total: 0 })) } as unknown as EmployeeService;

describe('employee router', () => {
  it('exposes an admin-only paginated employee list', async () => {
    const response = await request(createApp({ authService: auth, employeeService: service })).get('/api/v1/employees');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
  });

  it('rejects employee-role access', async () => {
    const employeeAuth = { authenticate: vi.fn(async () => ({ actorType: 'employee', employeeId: 1 })) } as unknown as AuthService;
    expect((await request(createApp({ authService: employeeAuth, employeeService: service })).get('/api/v1/employees')).status).toBe(403);
  });

  it('returns a structured validation error for rejected multipart files', async () => {
    const response = await request(createApp({ authService: auth, employeeService: service }))
      .post('/api/v1/employees').attach('unexpected', Buffer.from('x'), 'x.jpg');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_IMAGE');
  });

  it('keeps a newly committed replacement when deleting the old image fails', async () => {
    const oldEmployee = { id: 1, images: { personal: { storagePath: 'employees/old.png' } } };
    const replacementService = { get: vi.fn(async () => oldEmployee), update: vi.fn(async () => ({ employee: { ...oldEmployee, images: { personal: { storagePath: 'employees/new.png' } } }, replacedImages: { personal: { storagePath: 'employees/old.png' } } })) } as unknown as EmployeeService;
    const remove = vi.fn(async (path: string) => { if (path.endsWith('old.png')) throw new Error('locked'); });
    const recordCleanupFailure = vi.fn(async () => undefined);
    const store = { save: vi.fn(async () => ({ storagePath: 'employees/new.png', originalName: 'new.png', mimeType: 'image/png', sizeBytes: 1 })), remove, recordCleanupFailure } as unknown as EmployeeUploadStore;
    const response = await request(createApp({ authService: auth, employeeService: replacementService, employeeUploadStore: store }))
      .patch('/api/v1/employees/1').attach('personal', Buffer.from('image'), 'new.png');
    expect(response.status).toBe(200);
    expect(remove).toHaveBeenCalledWith('employees/old.png');
    expect(remove).not.toHaveBeenCalledWith('employees/new.png');
    expect(recordCleanupFailure).toHaveBeenCalledWith('employees/old.png', expect.any(Error));
  });
});
