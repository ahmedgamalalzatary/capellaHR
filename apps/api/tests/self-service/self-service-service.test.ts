import { describe, expect, it, vi } from 'vitest';

import { createSelfServiceService } from '../../src/modules/self-service/index.js';

const employee = {
  id: 7,
  employeeCode: 42,
  fullName: 'موظف الاختبار',
  personalPhone: '01012345678',
  whatsappPhone: '01112345678',
  age: 31,
  address: 'القاهرة',
  branchId: 3,
  shiftDurationMinutes: 480,
  monthlyBaseSalary: '5000.00',
  images: {
    personal: { storagePath: 'secret-personal', originalName: 'p.jpg', mimeType: 'image/jpeg', sizeBytes: 10 },
    idFront: { storagePath: 'secret-front', originalName: 'f.jpg', mimeType: 'image/jpeg', sizeBytes: 10 },
    idBack: { storagePath: 'secret-back', originalName: 'b.jpg', mimeType: 'image/jpeg', sizeBytes: 10 },
  },
      employmentStatus: 'active' as const,
      deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-07-01T00:00:00.000Z'),
};

const branch = {
  id: 3,
  name: 'الفرع الرئيسي',
  location: 'وسط البلد',
  nameNormalized: 'internal-hash',
  latitude: 30,
  longitude: 31,
  gpsAccuracyMeters: 5,
  attendanceRadiusMeters: 100,
  hasEverBeenReferenced: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const makeDependencies = () => ({
  employees: { get: vi.fn(async () => employee) },
  branches: { get: vi.fn(async () => branch) },
  attendance: { listSessions: vi.fn(async () => ({ items: [{
    id: 11,
    employeeId: 7,
    employeeCode: 42,
    employeeName: employee.fullName,
    branchId: 3,
    branchName: branch.name,
    attendanceDate: '2026-07-20',
    requiredMinutes: 480,
    checkInAt: new Date('2026-07-20T06:00:00.000Z'),
    checkOutAt: new Date('2026-07-20T14:00:00.000Z'),
    workedMinutes: 480,
    overtimeMinutes: 0,
    shortageMinutes: 0,
    automaticTimeoutAt: null,
    automaticTimeoutCorrectedAt: null,
    flagged: false,
    createdAt: new Date('2026-07-20T06:00:00.000Z'),
    updatedAt: new Date('2026-07-20T14:00:00.000Z'),
  }], total: 1 })) },
  weeklyDays: { list: vi.fn(async () => ({ items: [], total: 0 })) },
  payroll: {
    getBaseSalary: vi.fn(async () => ({
      employeeId: 7, employeeCode: 42, employeeName: employee.fullName,
      branchId: 3, branchName: branch.name, amount: '5000.00', deletedAt: null,
    })),
    preview: vi.fn(async () => ({
      id: 9, employeeId: 7, employeeCode: 42, employeeName: employee.fullName,
      branchId: 3, branchName: branch.name, payrollMonth: '2026-06', status: 'finalized' as const,
      baseSalary: '5000.00', proratedBase: '5000.00', overtimeAmount: '0.00', bonusAmount: '100.00',
      attendanceDeductionAmount: '0.00', manualDeductionAmount: '20.00', advanceAmount: '200.00',
      priorNegativeCarry: '0.00', netSalary: '4880.00', eligibleWorkdays: 20, fullMonthWorkdays: 20,
      requiredMinutes: 9600, overtimeMinutes: 0, shortageMinutes: 0,
      finalizedAt: new Date('2026-07-01T00:00:00.000Z'),
    })),
  },
  bonuses: { list: vi.fn(async () => ({ items: [], total: 0 })) },
  deductions: { list: vi.fn(async () => ({ items: [], total: 0 })) },
  advances: { list: vi.fn(async () => ({ items: [], total: 0 })) },
});

describe('employee self-service service', () => {
  it('projects an own-profile overview without images, secrets, GPS, or internal state', async () => {
    const service = createSelfServiceService(makeDependencies());

    const result = await service.getOverview(7);

    expect(result).toEqual({
      profile: {
        employeeCode: 42,
        fullName: 'موظف الاختبار',
        personalPhone: '01012345678',
        whatsappPhone: '01112345678',
        age: 31,
        address: 'القاهرة',
      },
      branch: { name: 'الفرع الرئيسي', location: 'وسط البلد' },
      shift: { durationMinutes: 480 },
      baseSalary: { amount: '5000.00', currency: 'EGP' },
    });
    expect(JSON.stringify(result)).not.toMatch(/image|storagePath|pin|credential|latitude|longitude|Radius|Normalized|employeeId/iu);
  });

  it('forces the authenticated employee identity into every history read', async () => {
    const dependencies = makeDependencies();
    const service = createSelfServiceService(dependencies);

    const attendance = await service.listAttendance(7, { state: 'closed', page: 2, pageSize: 10 });
    await service.listWeeklyDays(7, { status: 'weekly_day_off', page: 2, pageSize: 10 });
    await service.listBonuses(7, { payrollMonth: '2026-06', page: 2, pageSize: 10 });
    await service.listDeductions(7, { page: 1, pageSize: 20 });
    await service.listAdvances(7, { page: 1, pageSize: 20 });

    expect(dependencies.attendance.listSessions).toHaveBeenCalledWith({
      employeeId: 7, state: 'closed', page: 2, pageSize: 10,
    });
    expect(attendance.items).toEqual([expect.objectContaining({
      id: 11, attendanceDate: '2026-07-20', state: 'closed', workedMinutes: 480,
    })]);
    expect(JSON.stringify(attendance)).not.toMatch(/employeeId|employeeCode|employeeName|branchId|branchName|flagged/);
    expect(dependencies.weeklyDays.list).toHaveBeenCalledWith({
      employeeId: 7, status: 'weekly_day_off', page: 2, pageSize: 10,
    });
    expect(dependencies.bonuses.list).toHaveBeenCalledWith({
      employeeId: 7, payrollMonth: '2026-06', page: 2, pageSize: 10,
    });
    expect(dependencies.deductions.list).toHaveBeenCalledWith({ employeeId: 7, page: 1, pageSize: 20 });
    expect(dependencies.advances.list).toHaveBeenCalledWith({ employeeId: 7, page: 1, pageSize: 20 });
  });

  it('reads a payroll month only for the authenticated employee and removes company identity fields', async () => {
    const dependencies = makeDependencies();
    const service = createSelfServiceService(dependencies);

    const result = await service.getPayrollMonth(7, '2026-06');

    expect(dependencies.payroll.preview).toHaveBeenCalledWith(7, '2026-06');
    expect(result).toMatchObject({ payrollMonth: '2026-06', status: 'finalized', netSalary: '4880.00' });
    expect(result).not.toHaveProperty('employeeId');
    expect(result).not.toHaveProperty('branchId');
    expect(result).not.toHaveProperty('employeeName');
  });
});
