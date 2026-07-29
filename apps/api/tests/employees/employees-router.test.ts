import { createApp } from '../../src/app.js';
import type { AuthService } from '../../src/modules/auth/auth-service.js';
import { EmployeeError, type EmployeeService } from '../../src/modules/employees/employees-service.js';
import type { EmployeeUploadStore } from '../../src/modules/employees/employee-upload-store.js';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const auth = { authenticate: vi.fn(async () => ({ actorType: 'admin' })) } as unknown as AuthService;
const service = { list: vi.fn(async () => ({ items: [], total: 0 })) } as unknown as EmployeeService;

describe('employee router', () => {
  it('exposes an admin-only paginated employee list', async () => {
    const response = await request(createApp({ authService: auth, employeeService: service, employeeUploadMaxBytes: 16_777_216 })).get('/api/v1/employees');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
  });

  it('rejects employee-role access', async () => {
    const employeeAuth = { authenticate: vi.fn(async () => ({ actorType: 'employee', employeeId: 1 })) } as unknown as AuthService;
    expect((await request(createApp({ authService: employeeAuth, employeeService: service, employeeUploadMaxBytes: 16_777_216 })).get('/api/v1/employees')).status).toBe(403);
  });

  it('returns a structured validation error for rejected multipart files', async () => {
    const response = await request(createApp({ authService: auth, employeeService: service, employeeUploadMaxBytes: 16_777_216 }))
      .post('/api/v1/employees').attach('unexpected', Buffer.from('x'), 'x.jpg');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_IMAGE');
  });

  it('creates an employee without image uploads or an image store', async () => {
    const create = vi.fn(async (input) => ({ id: 1, employeeCode: 1, ...input }));
    const createService = { create } as unknown as EmployeeService;
    const response = await request(createApp({
      authService: auth,
      employeeService: createService,
      employeeUploadMaxBytes: 16_777_216,
    })).post('/api/v1/employees').send({
      fullName: 'موظف جديد',
      personalPhone: '01012345678',
      whatsappPhone: '01112345678',
      pin: '1234',
      age: 30,
      address: 'القاهرة',
      branchId: 1,
      shiftDurationMinutes: 480,
      monthlyBaseSalary: '5000.00',
    });

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ images: {} }));
  });

  it('maps the injected Multer size limit to IMAGE_TOO_LARGE', async () => {
    const response = await request(createApp({
      authService: auth,
      employeeService: service,
      employeeUploadMaxBytes: 1,
    })).post('/api/v1/employees').attach('personal', Buffer.from('xx'), 'photo.jpg');

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({
      code: 'IMAGE_TOO_LARGE',
      message: 'حجم الصورة يتجاوز الحد الأقصى المسموح',
    });
  });

  it('preserves contract field errors for invalid employee changes', async () => {
    const response = await request(createApp({ authService: auth, employeeService: service, employeeUploadMaxBytes: 16_777_216 }))
      .patch('/api/v1/employees/1')
      .send({ shiftDurationMinutes: '721' });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      fieldErrors: {
        shiftDurationMinutes: ['مدة الوردية يجب أن تكون بين دقيقة واحدة و12 ساعة'],
      },
    });
  });

  it('rejects an empty update instead of mutating only updatedAt', async () => {
    const update = vi.fn(async () => ({ employee: {}, replacedImages: {} }));
    const updateService = { update } as unknown as EmployeeService;

    const response = await request(createApp({
      authService: auth,
      employeeService: updateService,
      employeeUploadMaxBytes: 16_777_216,
    })).patch('/api/v1/employees/1').send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(update).not.toHaveBeenCalled();
  });

  it('keeps a newly committed replacement when deleting the old image fails', async () => {
    const oldEmployee = { id: 1, images: { personal: { storagePath: 'employees/old.png' } } };
    const replacementService = { get: vi.fn(async () => oldEmployee), update: vi.fn(async () => ({ employee: { ...oldEmployee, images: { personal: { storagePath: 'employees/new.png' } } }, replacedImages: { personal: { storagePath: 'employees/old.png' } } })) } as unknown as EmployeeService;
    const remove = vi.fn(async (path: string) => { if (path.endsWith('old.png')) throw new Error('locked'); });
    const recordCleanupFailure = vi.fn(async () => undefined);
    const store = { save: vi.fn(async () => ({ storagePath: 'employees/new.png', originalName: 'new.png', mimeType: 'image/png', sizeBytes: 1 })), remove, recordCleanupFailure } as unknown as EmployeeUploadStore;
    const response = await request(createApp({ authService: auth, employeeService: replacementService, employeeUploadStore: store, employeeUploadMaxBytes: 16_777_216 }))
      .patch('/api/v1/employees/1').attach('personal', Buffer.from('image'), 'new.png');
    expect(response.status).toBe(200);
    expect(remove).toHaveBeenCalledWith('employees/old.png');
    expect(remove).not.toHaveBeenCalledWith('employees/new.png');
    expect(recordCleanupFailure).toHaveBeenCalledWith('employees/old.png', expect.any(Error));
  });

  it('previews, confirms deactivation, and reactivates through explicit admin endpoints', async () => {
    const lifecycleService = {
      previewDeactivation: vi.fn(async () => ({
        unpaidInstallmentCount: 3,
        unpaidAdvanceAmount: '3000.00',
        currentNetSalary: '2000.00',
        projectedNetSalary: '-1000.00',
        amountOwed: '1000.00',
        canZeroSalary: true,
        hasOpenSession: false,
      })),
      deactivate: vi.fn(async () => ({
        employee: { id: 1, employmentStatus: 'inactive' },
        pendingUntilCheckOut: false,
      })),
      activate: vi.fn(async () => ({ id: 1, employmentStatus: 'active' })),
    } as unknown as EmployeeService;
    const app = createApp({
      authService: auth,
      employeeService: lifecycleService,
      employeeUploadMaxBytes: 16_777_216,
    });

    expect((await request(app).get('/api/v1/employees/1/deactivation-preview')).body.data)
      .toMatchObject({ unpaidInstallmentCount: 3, amountOwed: '1000.00', canZeroSalary: true });
    expect((await request(app).post('/api/v1/employees/1/deactivate').send({
      advanceDecision: 'sum_all',
      negativeBalanceDecision: 'record_debt',
      expectedUnpaidInstallmentCount: 3,
      expectedUnpaidAdvanceAmount: '3000.00',
      expectedProjectedNetSalary: '-1000.00',
      expectedAmountOwed: '1000.00',
    })).body.data).toMatchObject({ employmentStatus: 'inactive' });
    expect((await request(app).post('/api/v1/employees/1/activate')).body.data)
      .toMatchObject({ employmentStatus: 'active' });
  });

  it('reports a deactivation deferred until the employee checks out', async () => {
    const service = {
      deactivate: vi.fn(async () => ({
        employee: { id: 1, employmentStatus: 'active' },
        pendingUntilCheckOut: true,
      })),
    } as unknown as EmployeeService;
    const app = createApp({
      authService: auth, employeeService: service, employeeUploadMaxBytes: 16_777_216,
    });

    const response = await request(app).post('/api/v1/employees/1/deactivate').send({
      advanceDecision: 'ignore_debt',
      expectedUnpaidInstallmentCount: 0,
      expectedUnpaidAdvanceAmount: '0.00',
      expectedProjectedNetSalary: '0.00',
      expectedAmountOwed: '0.00',
    });

    expect(response.body.meta).toEqual({ pendingUntilCheckOut: true });
    expect(response.body.data).toMatchObject({ employmentStatus: 'active' });
  });

  it('rejects a deactivation that omits how to settle a shortfall', async () => {
    const service = {
      deactivate: vi.fn(() => {
        throw new EmployeeError('EMPLOYEE_NEGATIVE_BALANCE_DECISION_REQUIRED', 'يجب تحديد كيفية تسوية المبلغ المتبقي على الموظف');
      }),
    } as unknown as EmployeeService;
    const app = createApp({
      authService: auth, employeeService: service, employeeUploadMaxBytes: 16_777_216,
    });

    const response = await request(app).post('/api/v1/employees/1/deactivate').send({
      advanceDecision: 'sum_all',
      expectedUnpaidInstallmentCount: 3,
      expectedUnpaidAdvanceAmount: '3000.00',
      expectedProjectedNetSalary: '-1000.00',
      expectedAmountOwed: '1000.00',
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('EMPLOYEE_NEGATIVE_BALANCE_DECISION_REQUIRED');
  });
});
