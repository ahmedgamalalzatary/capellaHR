import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { createDatabase } from '@capella/database';
import { createEmployeeUploadStore } from './employee-upload-store.js';
import { createDrizzleEmployeeRepository } from './employees-repository.js';
import { createEmployeeService } from './employees-service.js';
export const createEmployeesModule = (database: ReturnType<typeof createDatabase>, attendance?: { hasOpenSession(id: number): Promise<boolean> }, existingRepository?: ReturnType<typeof createDrizzleEmployeeRepository>) => {
  const repository = existingRepository ?? createDrizzleEmployeeRepository(database); const uploadStore = createEmployeeUploadStore(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../uploads/employees'));
  return { repository, uploadStore, service: createEmployeeService(repository, attendance) };
};
