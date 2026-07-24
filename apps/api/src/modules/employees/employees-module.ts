import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { createDatabase } from '@capella/database';
import { createEmployeeUploadStore } from './employee-upload-store.js';
import type { EmployeeUploadStore } from './employee-upload-store.js';
import { createDrizzleEmployeeRepository } from './employees-repository.js';
import { createEmployeeService } from './employees-service.js';
export const createEmployeesModule = (database: ReturnType<typeof createDatabase>, maxImageBytes: number, attendance?: { hasOpenSession(id: number, context?: unknown): Promise<boolean>; hasAnyOpenSession(id: number, context?: unknown): Promise<boolean> }, existingRepository?: ReturnType<typeof createDrizzleEmployeeRepository>, deviceLifecycle?: { revokeEmployee(id: number, context?: unknown): Promise<void> }, financialLifecycle?: { prepareEmployeeDeletion(id: number, deletedAt: Date, context?: unknown): Promise<void> }, existingUploadStore?: EmployeeUploadStore) => {
  const repository = existingRepository ?? createDrizzleEmployeeRepository(database); const uploadStore = existingUploadStore ?? createEmployeeUploadStore(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../uploads/employees'), maxImageBytes);
  return { repository, uploadStore, service: createEmployeeService(repository, attendance, deviceLifecycle, financialLifecycle) };
};
